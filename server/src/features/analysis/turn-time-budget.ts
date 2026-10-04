import type { ModelPort, ModelResponse } from '../../model/model.port.js';
import type { ModelRequest } from '../../model/ports.js';
import { BudgetLedger } from '../../model/budget.js';
import { estimateInputTokens } from '../../model/token-estimate.js';
import { nodeTimeoutMs, workflowBudget } from '../../workflows/runtime.js';

export type TurnTimeoutCode = 'MODEL_NODE_TIMEOUT' | 'TURN_DEADLINE_EXCEEDED';

export class TurnTimeoutError extends Error {
  constructor(readonly code: TurnTimeoutCode) {
    super(code);
    this.name = 'TurnTimeoutError';
  }
}

// 在既有租约内留出失败审计/事务收尾时间，不延长业务提交 deadline。
const FINALIZATION_MARGIN_MS = 1_000;

/** 即使 provider 不配合取消，迟到值/异常也不能继续教学流程。 */
function abortable<T>(execute: () => Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener('abort', abort, { once: true });
    Promise.resolve().then(() => {
      signal.throwIfAborted();
      return execute();
    }).then((value) => {
      if (signal.aborted) reject(signal.reason);
      else resolve(value);
    }, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}

export type TurnModelAttempt = Omit<ModelResponse, 'parsed'>;

/** 请求级时间/call/token 边界；复用 BudgetLedger，不引入隐式重试。 */
export class TurnTimeBudget {
  readonly signal: AbortSignal;
  readonly #controller = new AbortController();
  readonly #ledger: BudgetLedger;
  #lastAttempt: TurnModelAttempt | undefined;
  readonly #deadlineMs: number;
  readonly #timer: ReturnType<typeof setTimeout>;

  constructor(deadlineAt: string | undefined, parent: AbortSignal) {
    parent.throwIfAborted();
    const now = Date.now();
    const runtimeDeadline = now + workflowBudget('turn').deadline_ms;
    const reservedDeadline = deadlineAt === undefined ? runtimeDeadline : Date.parse(deadlineAt);
    this.#deadlineMs = Math.min(reservedDeadline, runtimeDeadline) - FINALIZATION_MARGIN_MS;
    if (!Number.isFinite(this.#deadlineMs) || this.#deadlineMs <= now) {
      throw new TurnTimeoutError('TURN_DEADLINE_EXCEEDED');
    }
    this.#ledger = new BudgetLedger({ workflow: 'turn', deadlineAt: new Date(this.#deadlineMs) });
    this.signal = AbortSignal.any([parent, this.#controller.signal]);
    this.#timer = setTimeout(() => this.#expire(), this.#deadlineMs - now);
    this.#timer.unref();
  }

  get callsUsed(): number { return this.#ledger.callsUsed; }
  get remainingCalls(): number { return this.#ledger.remainingCalls; }
  get lastAttempt(): TurnModelAttempt | undefined { return this.#lastAttempt; }

  canRecover(calls: number, outputTokens: number): boolean {
    this.#assertActive();
    return this.#ledger.remainingCalls >= calls
      && this.#ledger.remainingOutputTokens >= outputTokens
      && this.#ledger.remainingInputTokens > 0;
  }

  consumeSchemaRepair(): boolean { return this.#ledger.consumeSchemaRepair(); }
  consumeTextRewrite(): boolean { return this.#ledger.consumeTextRewrite(); }

  async run<T>(execute: () => Promise<T>): Promise<T> {
    this.#assertActive();
    const result = await abortable(execute, this.signal);
    this.#assertActive();
    return result;
  }

  async generate(provider: ModelPort, request: ModelRequest): Promise<ModelResponse> {
    this.#assertActive();
    request.signal.throwIfAborted();
    const startedAt = Date.now();
    const reservation = this.#ledger.authorizeCall({
      inputTokens: estimateInputTokens(request.system, request.input),
      outputTokens: request.maxOutputTokens,
    });
    // 不保存原始候选；失败也保留尝试的保守计费，Schema 失败不能变成零用量。
    this.#lastAttempt = {
      model: request.model ?? '', provider: 'unknown', elapsedMs: 0,
      usage: { input: reservation.inputTokens, output: reservation.outputTokens, kind: 'estimated' },
    };
    const node = new AbortController();
    const nodeDeadlineMs = Date.now() + nodeTimeoutMs('turn');
    const timer = setTimeout(() => node.abort(new TurnTimeoutError('MODEL_NODE_TIMEOUT')), nodeTimeoutMs('turn'));
    timer.unref();
    const signal = AbortSignal.any([this.signal, request.signal, node.signal]);
    try {
      const response = await abortable(() => provider.generate({ ...request, latencyProfile: 'interactive', signal }), signal);
      this.#assertActive();
      if (Date.now() >= nodeDeadlineMs) throw new TurnTimeoutError('MODEL_NODE_TIMEOUT');
      const usage = response.usage.kind === 'unknown'
        ? { input: reservation.inputTokens, output: reservation.outputTokens, kind: 'estimated' as const }
        : response.usage;
      this.#lastAttempt = {
        model: response.model, provider: response.provider, elapsedMs: response.elapsedMs, usage,
        ...(response.providerRequestId ? { providerRequestId: response.providerRequestId } : {}),
        ...(response.reasoningEffort ? { reasoningEffort: response.reasoningEffort } : {}),
        ...(response.outputVerbosity ? { outputVerbosity: response.outputVerbosity } : {}),
        ...(response.latencyProfileVersion ? { latencyProfileVersion: response.latencyProfileVersion } : {}),
      };
      this.#ledger.settle(reservation, { inputTokens: usage.input, outputTokens: usage.output });
      return { ...response, usage };
    } finally {
      clearTimeout(timer);
      if (this.#lastAttempt?.provider === 'unknown') {
        this.#lastAttempt = { ...this.#lastAttempt, elapsedMs: Math.max(0, Date.now() - startedAt) };
      }
    }
  }

  dispose(): void {
    clearTimeout(this.#timer);
  }

  #assertActive(): void {
    if (Date.now() >= this.#deadlineMs) this.#expire();
    this.signal.throwIfAborted();
  }

  #expire(): void {
    this.#controller.abort(new TurnTimeoutError('TURN_DEADLINE_EXCEEDED'));
  }
}

/** 生成结束也不能替代提交前的取消/期限复核；最终 CAS/owner/lease 仍由事务门面检查。 */
export function assertTurnCanCommit(deadlineAt: string, signal: AbortSignal): void {
  signal.throwIfAborted();
  const deadlineMs = Date.parse(deadlineAt);
  if (!Number.isFinite(deadlineMs) || Date.now() >= deadlineMs) {
    throw new TurnTimeoutError('TURN_DEADLINE_EXCEEDED');
  }
}
