// SUBMIT_TURN_DEPS 的 turn 适配器：把 A 的会话快照接到 B 的四角色链路上。
//
// 这些用例断言的是**发往 provider 的真实请求体**（AT27 的手法），而不是投影结果——
// 投影正确但请求体越界同样算泄露，且更危险。
//
// 另有一条不变量用例：探针上限跨轮生效。它是 B03 的教学红线，而它只有在计数
// 「按已真实显示的次数」逐轮累加时才成立。

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  PacketSchema,
  TurnInputSchema,
  type GuardResult,
  type Packet,
  type TurnInput,
} from '../../src/contracts/domain.schema.js';
import { FixtureProvider } from '../../src/model/fixture.provider.js';
import type { ModelPort, ModelRequest, ModelResponse } from '../../src/model/ports.js';
import { MemoryStore } from '../../src/workflows/memory-store.js';
import { createTurnRunner } from '../../src/features/tutor/submit-turn.deps.js';
import type { TutorSession } from '../../src/features/tutor/tutor.service.js';

const fixturesDirectory = path.resolve(import.meta.dirname, '..', '..', '..', 'qisi-sdd-v3', 'fixtures');
const read = <T>(name: string): T => JSON.parse(readFileSync(path.join(fixturesDirectory, name), 'utf8')) as T;

const packet = PacketSchema.parse(read<Packet>('packet.json'));
const problem = read<TutorSession['problem']>('problem.json');
const diagnosisFixture = read<Record<string, unknown>>('diagnosis.json');
const strategyFixture = read<Record<string, unknown>>('strategy.json');
const guardFixture = read<GuardResult>('guard.json');

const SESSION_ID = 'session-deps';
const HISTORY_STUDENT_TEXT = 'f′(x)=1+1/x²';
const CURRENT_TEXT = '我把分子分母同时乘以根号三，再约分';
const RENDERED_TEXT = '只看倒数项，你怎样说明它的求导依据？';

const MODELS = {
  preparation: 'm-prep',
  diagnosis: 'm-diag',
  strategy: 'm-strat',
  assessment: 'm-assess',
  renderer: 'm-render',
  guard: 'm-guard',
} as const;

/** 记录每个 role 实际收到的完整请求体——所有越界断言的对象都是它。 */
class RecordingProvider implements ModelPort {
  readonly requests: ModelRequest[] = [];

  constructor(private readonly inner: ModelPort) {}

  async generate(request: ModelRequest): Promise<ModelResponse> {
    this.requests.push(request);
    return this.inner.generate(request);
  }

  forRole(role: ModelRequest['role']): ModelRequest | undefined {
    return this.requests.find((request) => request.role === role);
  }
}

function session(overrides: Partial<TutorSession> = {}): TutorSession {
  return {
    id: SESSION_ID,
    version: 1,
    phase: 'study',
    problem,
    packetVersion: packet.version,
    decisions: packet.decisions,
    routes: packet.routes,
    referenceMd: packet.reference_md,
    checkTask: packet.check_tasks[0] ?? null,
    // 已提交的历史：端口从 learning_messages 读出来的学生消息。
    // id 取 's1' 以对齐夹具 session.json —— 夹具 diagnosis.json 的 evidence_refs
    // 正是指向 (s1, revision 1, quote f′(x)=1+1/x²)，B04 的证据准入会逐条核对。
    messages: [{ id: 's1', role: 'student', text_md: HISTORY_STUDENT_TEXT, created_at: '2026-09-15T00:00:00.000Z' }],
    currentGoalKey: null,
    attempt: null,
    notice: '',
    canStartCheck: false,
    ...overrides,
  };
}

function turnInput(overrides: Partial<TurnInput> = {}): TurnInput {
  return TurnInputSchema.parse({
    session_id: SESSION_ID,
    expected_version: 1,
    request_id: 'req-deps-1',
    action: 'attempt',
    text_md: CURRENT_TEXT,
    transcript_id: null,
    transcript_revision: null,
    ...overrides,
  });
}

function createHarness(
  options: {
    readonly producedDiagnosis?: unknown;
    readonly guard?: GuardResult;
    /**
     * 需要几轮夹具。FixtureProvider 按 role 逐条消费，缺一条即 MissingFixtureError，
     * 因此多轮用例必须入队多份；被 Guard 退回的一轮还会触发一次重写，额外消耗
     * 一次 renderer + guard。
     */
    readonly turns?: number;
  } = {},
) {
  const store = new MemoryStore();
  store.seedSession(SESSION_ID, 1);

  const fixture = new FixtureProvider();
  for (let index = 1; index <= (options.turns ?? 1); index++) {
    fixture.enqueue('diagnosis', { id: `d${index}`, parsed: options.producedDiagnosis ?? diagnosisFixture });
    fixture.enqueue('strategy', { id: `s${index}`, parsed: strategyFixture });
    fixture.enqueue('renderer', { id: `r${index}`, parsed: { text_md: RENDERED_TEXT } });
    fixture.enqueue('guard', { id: `g${index}`, parsed: options.guard ?? guardFixture });
  }

  const provider = new RecordingProvider(fixture);
  const runner = createTurnRunner({ store, modelPort: provider, models: MODELS, configHash: 'cfg-deps' });

  return { provider, runner };
}

/** 复刻 TutorService 的调用顺序：提交成功后立刻记一次真实曝光。 */
async function submit(
  runner: ReturnType<typeof createTurnRunner>,
  current: TutorSession,
  input: TurnInput,
) {
  const outcome = await runner.runTurn({
    sessionId: current.id,
    requestId: input.request_id,
    payloadHash: `hash-${input.request_id}`,
    expectedVersion: input.expected_version,
    input,
    session: current,
  });
  if (outcome.status === 'committed') {
    await runner.recordProbe({ sessionId: current.id, taskId: current.problem.id, input });
  }
  return outcome;
}

describe('turn 适配器：诊断证据来自会话与本轮输入', () => {
  it('历史学生消息与本轮输入都作为已确认证据进入 Diagnosis', async () => {
    const { provider, runner } = createHarness();
    await submit(runner, session(), turnInput());

    const diagnosis = provider.forRole('diagnosis');
    expect(diagnosis, '未产生 diagnosis 调用').toBeDefined();
    const input = diagnosis?.input as { confirmed_evidence: { text_md: string; confirmed: boolean; task_id: string }[] };

    const texts = input.confirmed_evidence.map((item) => item.text_md);
    expect(texts).toContain(HISTORY_STUDENT_TEXT);
    expect(texts).toContain(CURRENT_TEXT);
    // 证据必须标成「已确认且属于本任务」，否则 projectDiagnosisInput 会把它过滤掉。
    for (const item of input.confirmed_evidence) {
      expect(item.confirmed).toBe(true);
      expect(item.task_id).toBe(packet.problem_id);
    }
  });

  it('会话没有检验题时教学轮照常进行——教学轮不读 checkTask', async () => {
    const { provider, runner } = createHarness();
    const outcome = await submit(runner, session({ checkTask: null }), turnInput());

    expect(outcome.status).toBe('committed');
    expect(provider.forRole('renderer')).toBeDefined();
  });
});

describe('turn 适配器：策略输入基于本轮诊断', () => {
  it('策略节点收到的是本轮产出的诊断，而不是夹具里那份', async () => {
    const producedSummary = '本轮产出的诊断标记-9c41';
    const { provider, runner } = createHarness({
      producedDiagnosis: { ...diagnosisFixture, summary: producedSummary },
    });
    await submit(runner, session(), turnInput());

    const strategy = provider.forRole('strategy');
    expect(strategy, '未产生 strategy 调用').toBeDefined();
    const serialised = JSON.stringify(strategy?.input);

    expect(serialised).toContain(producedSummary);
    expect(serialised).not.toContain(diagnosisFixture.summary);
  });
});

describe('turn 适配器：发往表达与守卫的内容不越界', () => {
  it('Renderer 的公开历史含本轮输入，但不含私有参考与未来 rubric', async () => {
    const { provider, runner } = createHarness();
    await submit(runner, session(), turnInput());

    const renderer = provider.forRole('renderer');
    expect(renderer, '未产生 renderer 调用').toBeDefined();
    const serialised = JSON.stringify(renderer);

    const input = renderer?.input as { public_history_md: string[] };
    expect(input.public_history_md).toContain(CURRENT_TEXT);

    // 私有参考正文与字段名都不得出现——改掉字段名不算修好。
    expect(serialised).not.toContain('private_reference_md');
    expect(serialised).not.toContain(packet.reference_md);
    // 未来检验题的 rubric 不得提前出现。
    const checkTask = packet.check_tasks[0];
    expect(checkTask?.execution_rubric).toBeTruthy();
    expect(serialised).not.toContain(checkTask?.execution_rubric as string);
  });

  it('守卫收到的是本轮策略批准的披露边界', async () => {
    const { provider, runner } = createHarness();
    await submit(runner, session(), turnInput());

    const guard = provider.forRole('guard');
    expect(guard, '未产生 guard 调用').toBeDefined();
    const input = guard?.input as { allowed_disclosures: string[]; reserved_decisions: string[] };

    // 取自本轮策略产出，而不是调用方预置的空数组。
    expect(input.allowed_disclosures).toEqual(strategyFixture.allowed_disclosures);
    expect(input.reserved_decisions).toEqual(strategyFixture.reserved_decisions);
  });
});

describe('turn 适配器：被拒时的对外表现', () => {
  it('Guard 拒绝时返回 rejected、无文本，且中性说明不泄露内部标识', async () => {
    // 重写一次会再消耗一次 renderer + guard，故入队两轮。
    const { runner } = createHarness({ guard: { ...guardFixture, verdict: 'revise' }, turns: 2 });
    const outcome = await submit(runner, session(), turnInput());

    expect(outcome.status).toBe('rejected');
    expect(outcome.textMd).toBeNull();
    expect(outcome.notice.length).toBeGreaterThan(0);
    // notice 会经 StudentView.notice 直接展示给学生，因此不得转发 decision.reason——
    // 它含 goal_key 等内部标识。
    expect(outcome.notice).not.toContain('self-001');
    for (const decision of packet.decisions) {
      expect(outcome.notice).not.toContain(decision.goal_key);
      expect(outcome.notice).not.toContain(decision.id);
    }
  });
});

describe('turn 适配器：探针上限跨轮生效', () => {
  it('同一目标显示两次后，第三轮探针被拒——上限不会因换轮次而重置', async () => {
    const { runner } = createHarness({ turns: 3 });

    const first = await submit(runner, session({ version: 1 }), turnInput({ request_id: 'req-p1' }));
    const second = await submit(runner, session({ version: 2 }), turnInput({ request_id: 'req-p2', expected_version: 2 }));
    const third = await submit(runner, session({ version: 3 }), turnInput({ request_id: 'req-p3', expected_version: 3 }));

    expect(first.status, '第一轮应当提交成功').toBe('committed');
    expect(second.status, '第二轮应当提交成功').toBe('committed');
    expect(third.status, '第三轮的探针应被上限拒绝').toBe('rejected');
  });
});
