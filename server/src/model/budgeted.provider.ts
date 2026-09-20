// 预算化 ModelPort 装饰器：所有模型调用的唯一收口。
//
// 为什么用装饰器而不是让各 Agent 自己记账：agents.json 的 max_schema_repair_shared=1
// 是 run 级共享额度，且 AGENTS.md §7 要求「所有模型尝试（含修复/重写/失败）计入统一
// call/token/time 预算」。把记账放在 Agent 之外，Agent 就没有遗漏或绕过记账的机会。
//
// 本装饰器负责四件事：
//   1. 调用前授权（call / token / deadline）
//   2. 调用后记账（失败也计——失败不退还额度）
//   3. usage 不可信时替换为保守估计
//   4. schema 校验失败时，在共享额度内最多修复一次
//
// 并发上限（runtime.json 的 max_concurrent_model_calls=4）由内部信号量保证。

import { z } from 'zod';
import type { BudgetLedger } from './budget.js';
import type { ModelPort, ModelRequest, ModelResponse, ModelUsage } from './ports.js';
import { estimateInputTokens } from './token-estimate.js';
import { RUNTIME_LIMITS } from '../workflows/runtime.js';

export class SchemaValidationError extends Error {
  readonly role: string;
  readonly issues: readonly string[];
  /** 修复额度是否已被本次 run 用尽，便于上层区分"没额度"与"修不好"。 */
  readonly repairExhausted: boolean;

  constructor(role: string, issues: readonly string[], repairExhausted: boolean) {
    super(`模型输出不符合 ${role} 的输出契约：${issues.join('; ')}`);
    this.name = 'SchemaValidationError';
    this.role = role;
    this.issues = issues;
    this.repairExhausted = repairExhausted;
  }
}

export class ProviderCallError extends Error {
  readonly role: string;

  constructor(role: string, cause: unknown) {
    super(`provider 调用失败（${role}）`);
    void cause; // Deliberately do not retain/log raw provider messages or credentials.
    this.name = 'ProviderCallError';
    this.role = role;
  }
}

/** 简单计数信号量。等待期间不占数据库事务（模型调用在事务外执行）。 */
class Semaphore {
  #available: number;
  readonly #waiters: { resolve: () => void; reject: (reason: unknown) => void; signal: AbortSignal; abort: () => void }[] = [];
  constructor(permits: number) {
    if (!Number.isSafeInteger(permits) || permits < 1) throw new Error('INVALID_CONCURRENCY');
    this.#available = permits;
  }
  async acquire(signal: AbortSignal): Promise<() => void> {
    signal.throwIfAborted();
    if (this.#available > 0) this.#available--;
    else await new Promise<void>((resolve, reject) => {
      const waiter = { resolve, reject, signal, abort: () => {
        const index = this.#waiters.indexOf(waiter);
        if (index >= 0) this.#waiters.splice(index, 1);
        reject(signal.reason);
      } };
      this.#waiters.push(waiter); signal.addEventListener('abort', waiter.abort, { once: true });
    });
    let released = false;
    return () => {
      if (released) return; released = true;
      const next = this.#waiters.shift();
      if (next) { next.signal.removeEventListener('abort', next.abort); next.resolve(); }
      else this.#available++;
    };
  }
}

/** A non-cooperating provider may keep billing, but its late output cannot be used. */
function untilAborted<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
    operation.then(value => { signal.removeEventListener('abort', abort); if (!signal.aborted) resolve(value); }, error => { signal.removeEventListener('abort', abort); reject(error); });
  });
}

function formatIssues(error: z.ZodError): string[] {
  return error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`);
}

/** 修复请求：把校验失败原因回注到 system，其余保持不变。input 不变即不改变业务上下文。 */
function buildRepairRequest(request: ModelRequest, issues: readonly string[]): ModelRequest {
  return {
    ...request,
    system: [
      request.system,
      '',
      '你上一次的输出未通过结构校验，请仅修正结构问题后重新输出完整结果，不要改变结论本身。',
      ...issues.map((issue) => `- ${issue}`),
    ].join('\n'),
  };
}

export interface BudgetedModelPortOptions {
  readonly now?: () => number;
  readonly maxConcurrent?: number;
}

export class BudgetedModelPort implements ModelPort {
  readonly #provider: ModelPort;
  readonly #ledger: BudgetLedger;
  readonly #semaphore: Semaphore;
  readonly #now: () => number;

  constructor(provider: ModelPort, ledger: BudgetLedger, options: BudgetedModelPortOptions = {}) {
    this.#provider = provider;
    this.#ledger = ledger;
    this.#semaphore = new Semaphore(options.maxConcurrent ?? RUNTIME_LIMITS.max_concurrent_model_calls);
    this.#now = options.now ?? (() => Date.now());
  }

  async generate(request: ModelRequest): Promise<ModelResponse> {
    const deadline = new AbortController();
    const timer = setTimeout(() => deadline.abort(new Error('DEADLINE_EXCEEDED')), this.#ledger.remainingTimeMs);
    timer.unref();
    const signal = AbortSignal.any([request.signal, this.#ledger.signal, deadline.signal]);
    let release: (() => void) | undefined;
    try {
      release = await this.#semaphore.acquire(signal);
      signal.throwIfAborted();
      return await this.#generateWithinPermit({ ...request, signal });
    } catch (error) {
      if (signal.aborted && !(error instanceof ProviderCallError)) throw new ProviderCallError(request.role, error);
      throw error;
    } finally { clearTimeout(timer); release?.(); }
  }

  async #generateWithinPermit(request: ModelRequest): Promise<ModelResponse> {
    let attempt: ModelRequest = request;
    let repaired = false;

    for (;;) {
      const authorised = estimateInputTokens(attempt.system, attempt.input);
      // 授权即预留（调用数与估计 token），队列等待也计入 deadline（contracts/README.md §6）。
      const reservation = this.#ledger.authorizeCall({ inputTokens: authorised, outputTokens: attempt.maxOutputTokens });

      const startedAt = this.#now();
      let response: ModelResponse;
      try {
        attempt.signal.throwIfAborted();
        response = await untilAborted(this.#provider.generate({ ...attempt, signal: this.#mergeSignals(attempt.signal) }), attempt.signal);
        attempt.signal.throwIfAborted();
      } catch (error) {
        // 失败不结算、不退还：预留继续占用额度。规格要求失败、超时、重试都计入预算。
        throw new ProviderCallError(attempt.role, error);
      }

      const usage = this.#resolveUsage(response, authorised, attempt.maxOutputTokens);
      this.#ledger.settle(reservation, { inputTokens: usage.input, outputTokens: usage.output });

      const outcome = attempt.outputSchema.safeParse(response.parsed);
      if (outcome.success) {
        return {
          ...response,
          parsed: outcome.data,
          usage,
          elapsedMs: response.elapsedMs > 0 ? response.elapsedMs : this.#now() - startedAt,
        };
      }

      const issues = formatIssues(outcome.error);
      // 修复额度是 run 级共享的。已修复过一次就不得再修，避免"自动修复"绕过预算。
      if (repaired || !this.#ledger.consumeSchemaRepair()) {
        throw new SchemaValidationError(attempt.role, issues, true);
      }
      repaired = true;
      attempt = buildRepairRequest(request, issues);
    }
  }

  /**
   * usage 可信度处理：provider 未报告精确用量时，用保守输入估计 + max_output 预留
   * 替换，并标记 estimated。绝不把 unknown 当作 0 消耗。
   */
  #resolveUsage(response: ModelResponse, authorisedInput: number, maxOutputTokens: number): ModelUsage {
    if (response.usage.kind === 'reported') return response.usage;
    return { input: authorisedInput, output: maxOutputTokens, kind: 'estimated' };
  }

  #mergeSignals(requestSignal: AbortSignal): AbortSignal {
    return AbortSignal.any([requestSignal, this.#ledger.signal]);
  }
}
