// run 级统一预算账本。
//
// 规格依据：
//   AGENTS.md §7「所有模型尝试（含修复/重写/失败）计入统一 call/token/time 预算；
//   按 runtime.json 禁用 SDK 隐式重试和图隐式节点重试。不借无限循环或"自动修复"绕过预算。」
//   agents.json 每个角色的 max_schema_repair_shared=1 —— 注意是 shared，即修复额度
//   在整个 run 内共享，而非每角色各一份。这决定了账本必须是 run 级单例。
//
// 纯逻辑，不依赖 Nest：时钟可注入，便于确定性验证 deadline 与 token 上限。

import { workflowBudget, type WorkflowBudget, type WorkflowName } from '../workflows/runtime.js';

export type BudgetExceededCode = 'CALLS_EXHAUSTED' | 'DEADLINE_EXCEEDED' | 'INPUT_TOKENS_EXCEEDED' | 'OUTPUT_TOKENS_EXCEEDED';

export class BudgetExceededError extends Error {
  readonly code: BudgetExceededCode;

  constructor(code: BudgetExceededCode, message: string) {
    super(message);
    this.name = 'BudgetExceededError';
    this.code = code;
  }
}

export interface BudgetCallAccounting {
  readonly inputTokens: number;
  readonly outputTokens: number;
}

/**
 * 一次调用的预留凭据。调用数在授权时即计入，token 在授权时按估计预留、
 * 返回后按实际结算。这样并发的多个调用不会同时挤过同一份额度。
 */
export type BudgetReservation = BudgetCallAccounting;

export interface BudgetLedgerOptions {
  readonly workflow: WorkflowName;
  /** 来自 StorePort.reserve 的 run deadline（ports.ts 的 ActiveRunContext.deadlineAt）。 */
  readonly deadlineAt: Date;
  /** 可注入时钟，返回 epoch 毫秒。默认使用系统时间。 */
  readonly now?: () => number;
}

export class BudgetLedger {
  readonly #budget: WorkflowBudget;
  readonly #deadlineMs: number;
  readonly #now: () => number;
  readonly #controller = new AbortController();

  readonly #pending = new Set<BudgetReservation>();
  #calls = 0;
  #inputTokens = 0;
  #outputTokens = 0;
  #schemaRepairs = 0;
  #textRewrites = 0;
  #routeReviews = 0;

  constructor(options: BudgetLedgerOptions) {
    this.#budget = workflowBudget(options.workflow);
    this.#deadlineMs = options.deadlineAt.getTime();
    if (!Number.isFinite(this.#deadlineMs)) throw new Error('INVALID_DEADLINE');
    this.#now = options.now ?? (() => Date.now());
  }

  /** 传给 ModelRequest.signal；预算耗尽或 run 取消时中止在途调用。 */
  get signal(): AbortSignal {
    return this.#controller.signal;
  }

  get workflowBudgetLimits(): WorkflowBudget {
    return this.#budget;
  }

  get callsUsed(): number {
    return this.#calls;
  }

  get remainingCalls(): number {
    return this.#budget.max_calls - this.#calls;
  }

  get remainingInputTokens(): number {
    return this.#budget.input_tokens_cap - this.#inputTokens;
  }

  get remainingOutputTokens(): number {
    return this.#budget.output_tokens_cap - this.#outputTokens;
  }

  get remainingTimeMs(): number { return Math.max(0, this.#deadlineMs - this.#now()); }

  get deadlineAt(): Date {
    return new Date(this.#deadlineMs);
  }

  /**
   * 调用前授权的唯一闸门，同时**预留**调用数与 token。
   *
   * 预留而非仅在事后记账，是因为并发的多个调用若都只做检查，会同时挤过同一份
   * 额度并突破上限（runtime.json 允许 max_concurrent_model_calls=4）。调用数在
   * 此处即计入，故失败、修复、重写、超时都自然占用额度，无需依赖调用方补记。
   *
   * 模型调用必须在数据库事务之外执行，因此本方法不做任何 IO。
   * 队列等待也计入 deadline（contracts/README.md §6），故此处一并检查时钟。
   */
  authorizeCall(accounting: BudgetCallAccounting): BudgetReservation {
    this.#controller.signal.throwIfAborted();
    this.#validateAccounting(accounting);
    if (this.#now() >= this.#deadlineMs) {
      throw new BudgetExceededError('DEADLINE_EXCEEDED', '工作流已超过 deadline');
    }
    if (this.#calls >= this.#budget.max_calls) {
      throw new BudgetExceededError('CALLS_EXHAUSTED', `工作流已达最大调用数 ${this.#budget.max_calls}`);
    }
    if (this.#inputTokens + accounting.inputTokens > this.#budget.input_tokens_cap) {
      throw new BudgetExceededError('INPUT_TOKENS_EXCEEDED', `输入 token 超出上限 ${this.#budget.input_tokens_cap}`);
    }
    if (this.#outputTokens + accounting.outputTokens > this.#budget.output_tokens_cap) {
      throw new BudgetExceededError('OUTPUT_TOKENS_EXCEEDED', `输出 token 超出上限 ${this.#budget.output_tokens_cap}`);
    }

    this.#calls += 1;
    this.#inputTokens += accounting.inputTokens;
    this.#outputTokens += accounting.outputTokens;

    const reservation = Object.freeze({ ...accounting });
    this.#pending.add(reservation);
    return reservation;
  }

  /**
   * 调用结束后按实际用量结算，把预留值替换为实际值。
   *
   * 调用失败时不结算（或按 output=0 结算），预留继续占用额度——规格要求失败、
   * 修复、重写、网络重试全部计入同一预算，不因失败而退还。
   */
  settle(reservation: BudgetReservation, actual: BudgetCallAccounting): void {
    if (!this.#pending.has(reservation)) throw new Error('INVALID_OR_SETTLED_RESERVATION');
    this.#validateAccounting(actual);
    this.#pending.delete(reservation);
    this.#inputTokens += actual.inputTokens - reservation.inputTokens;
    this.#outputTokens += actual.outputTokens - reservation.outputTokens;
    if (this.#inputTokens > this.#budget.input_tokens_cap || this.#outputTokens > this.#budget.output_tokens_cap) {
      this.cancel();
      throw new BudgetExceededError(this.#inputTokens > this.#budget.input_tokens_cap ? 'INPUT_TOKENS_EXCEEDED' : 'OUTPUT_TOKENS_EXCEEDED', '实际 token 用量超出预算');
    }
  }

  #validateAccounting(value: BudgetCallAccounting): void {
    if (![value.inputTokens, value.outputTokens].every(n => Number.isSafeInteger(n) && n >= 0)) throw new Error('INVALID_TOKEN_ACCOUNTING');
  }

  /** schema 修复：每 run 共 1 次，共享而非每角色一份。返回是否成功消费。 */
  consumeSchemaRepair(): boolean {
    if (this.#schemaRepairs >= 1) return false;
    this.#schemaRepairs += 1;
    return true;
  }

  /** 展示文本重写：每 run 最多一组（重写 + 随后的 Guard）。 */
  consumeTextRewrite(): boolean {
    if (this.#textRewrites >= 1) return false;
    this.#textRewrites += 1;
    return true;
  }

  /** route_review：每 turn 最多 1 次，且仅在剩余预算够 PreparationAgent + Guard 时执行。 */
  consumeRouteReview(): boolean {
    if (this.#routeReviews >= 1) return false;
    if (this.remainingCalls < 2) return false;
    this.#routeReviews += 1;
    return true;
  }

  /** 取消在途调用。远端是否真正停止计费不可保证（contracts/README.md §6）。 */
  cancel(): void {
    this.#controller.abort();
  }
}
