// FixtureProvider：确定性测试替身。
//
// 规格依据 B01 PRD F3：
//   「FixtureProvider 使用有标识的自拟夹具，按角色/场景返回可控数据，支持非法
//     JSON/Schema、超时、取消、unknown usage 和可记录的调用顺序；缺少匹配 fixture
//     应失败，不返回通用成功结果。」
//   「不得静默切换 FixtureProvider」——故 provider 名恒为 'fixture'，真实适配器使用
//     其他标识，调用记录可区分（contracts/README.md §10、stack-cases.json ST05）。
//
// 本实现不做 JSON 解析：直接返回注册的 parsed 值，以便测试精确控制走到装饰器的
// 是"合法结构"还是"结构错误"，从而分别验证正常路径与 schema 修复路径。

import { createHash } from 'node:crypto';
import type { ModelPort, ModelRequest, ModelResponse, ModelUsage, Role } from './ports.js';

export const FIXTURE_PROVIDER_NAME = 'fixture';

export type FixtureBehaviour =
  | 'ok'
  /** 返回无法通过输出契约的值，用于验证 schema 修复路径。 */
  | 'malformed'
  /** 在 delayMs 后以超时错误失败，用于验证节点超时不占满 deadline。 */
  | 'timeout'
  /** 立即以 AbortError 失败，用于验证取消路径。 */
  | 'cancel'
  /** provider 内部错误，用于验证失败尝试同样计入预算。 */
  | 'error'
  /** 正常返回但 usage 不可信，用于验证保守估计替换。 */
  | 'unknown_usage';

export interface FixtureEntry {
  /** 夹具标识，写入调用记录，便于断言"这一轮用了哪个夹具"。 */
  readonly id: string;
  readonly parsed: unknown;
  readonly behaviour?: FixtureBehaviour;
  readonly usage?: ModelUsage;
  readonly delayMs?: number;
  /** 覆盖响应的 provider 标识，用于断言 fixture 与真实模式可区分。 */
  readonly providerName?: string;
}

export interface RecordedModelCall {
  readonly role: Role;
  readonly model: string;
  readonly fixtureId: string;
  /** system 与 input 的摘要，用于断言上下文投影确实不同（AT13 的核心断言点）。 */
  readonly systemDigest: string;
  readonly inputDigest: string;
  readonly imageCount: number;
}

export class MissingFixtureError extends Error {
  readonly role: Role;
  readonly model: string;
  readonly queueDepth: number;

  constructor(role: Role, model: string, queueDepth: number) {
    super(`没有匹配的夹具：role=${role} model=${model}（该 role 已入队 ${queueDepth} 条，均已消费）`);
    this.name = 'MissingFixtureError';
    this.role = role;
    this.model = model;
    this.queueDepth = queueDepth;
  }
}

export class FixtureTimeoutError extends Error {
  constructor(role: Role, delayMs: number) {
    super(`夹具模拟节点超时：role=${role} delayMs=${delayMs}`);
    this.name = 'FixtureTimeoutError';
  }
}

function digest(value: unknown): string {
  let serialised: string;
  try {
    serialised = JSON.stringify(value) ?? String(value);
  } catch {
    serialised = String(value);
  }
  return createHash('sha256').update(serialised, 'utf8').digest('hex').slice(0, 16);
}

function abortError(): Error {
  const error = new Error('模型调用已取消');
  error.name = 'AbortError';
  return error;
}

export class FixtureProvider implements ModelPort {
  readonly providerName = FIXTURE_PROVIDER_NAME;
  readonly #queues = new Map<Role, FixtureEntry[]>();
  readonly #calls: RecordedModelCall[] = [];
  readonly #enqueuedTotals = new Map<Role, number>();

  /** 追加一条夹具到指定角色的队列。同角色多次入队按 FIFO 消费。 */
  enqueue(role: Role, entry: FixtureEntry): this {
    const queue = this.#queues.get(role) ?? [];
    queue.push(entry);
    this.#queues.set(role, queue);
    this.#enqueuedTotals.set(role, (this.#enqueuedTotals.get(role) ?? 0) + 1);
    return this;
  }

  enqueueAll(role: Role, entries: readonly FixtureEntry[]): this {
    for (const entry of entries) this.enqueue(role, entry);
    return this;
  }

  get calls(): readonly RecordedModelCall[] {
    return this.#calls;
  }

  /** 已发生的 role 调用序列。AT13 用它证明"不是一次调用伪造四阶段"。 */
  get roleSequence(): readonly Role[] {
    return this.#calls.map((call) => call.role);
  }

  reset(): void {
    this.#queues.clear();
    this.#calls.length = 0;
    this.#enqueuedTotals.clear();
  }

  async generate(request: ModelRequest): Promise<ModelResponse> {
    const queue = this.#queues.get(request.role) ?? [];
    const entry = queue.shift();
    if (!entry) {
      // 缺匹配夹具必须失败——不得返回通用成功结果冒充模型可用。
      throw new MissingFixtureError(request.role, request.model, this.#enqueuedTotals.get(request.role) ?? 0);
    }

    this.#calls.push({
      role: request.role,
      model: request.model,
      fixtureId: entry.id,
      systemDigest: digest(request.system),
      inputDigest: digest(request.input),
      imageCount: request.images?.length ?? 0,
    });

    const startedAt = Date.now();
    const behaviour = entry.behaviour ?? 'ok';

    if (behaviour === 'cancel') throw abortError();
    if (behaviour === 'error') throw new Error(`夹具 ${entry.id} 注入 provider 错误`);

    if (behaviour === 'timeout') {
      const delayMs = entry.delayMs ?? 10;
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      if (request.signal.aborted) throw abortError();
      throw new FixtureTimeoutError(request.role, delayMs);
    }

    if (entry.delayMs !== undefined && entry.delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, entry.delayMs));
      if (request.signal.aborted) throw abortError();
    }

    const usage: ModelUsage =
      behaviour === 'unknown_usage' ? { input: 0, output: 0, kind: 'unknown' } : (entry.usage ?? { input: 0, output: 0, kind: 'reported' });

    return {
      parsed: behaviour === 'malformed' ? `not-a-valid-payload:${entry.id}` : entry.parsed,
      providerRequestId: `fixture-${entry.id}`,
      usage,
      elapsedMs: Date.now() - startedAt,
      provider: entry.providerName ?? FIXTURE_PROVIDER_NAME,
      model: request.model,
    };
  }
}
