// submitTurn 应用边界行为。
//
// 覆盖 server-functions.json 对该操作声明的 effect（policy and guard then atomic commit）
// 在应用层的表现：版本 CAS、阶段限制、提交后才投影、失败不写消息。
//
// 不覆盖：模型调用与 PolicyGate 判定本身（见 test/workflows/**），
// 真实 MySQL 持久化（blocket_external，归 A 的 session 门面）。

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ProblemSchema, StudentViewSchema, TurnInputSchema, type TurnInput } from '../../src/contracts/domain.schema.js';
import {
  InMemoryTutorSessionPort,
  SessionVersionConflictError,
  TutorService,
  type TutorSession,
} from '../../src/features/tutor/tutor.service.js';

const fixturesDirectory = path.resolve(import.meta.dirname, '..', '..', '..', 'qisi-sdd-v3', 'fixtures');
const problem = ProblemSchema.parse(JSON.parse(readFileSync(path.join(fixturesDirectory, 'problem.json'), 'utf8')));

const SESSION_ID = 'session-submit-turn';

function session(overrides: Partial<TutorSession> = {}): TutorSession {
  return {
    id: SESSION_ID,
    version: 1,
    phase: 'study',
    problem,
    packetVersion: 'v1',
    decisions: [],
    routes: [],
    referenceMd: '',
    checkTask: null,
    messages: [],
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
    request_id: 'req-1',
    action: 'attempt',
    text_md: 'f′(x)=1+1/x²',
    transcript_id: null,
    transcript_revision: null,
    ...overrides,
  });
}

interface Harness {
  readonly service: TutorService;
  readonly sessions: InMemoryTutorSessionPort;
  readonly turns: { sessionId: string; requestId: string; payloadHash: string }[];
  readonly probes: { sessionId: string; taskId: string }[];
}

function createHarness(options: { readonly outcome?: 'committed' | 'rejected'; readonly textMd?: string | null } = {}) {
  const sessions = new InMemoryTutorSessionPort();
  const turns: Harness['turns'] = [];
  const probes: Harness['probes'] = [];
  const outcome = options.outcome ?? 'committed';
  const textMd = options.textMd === undefined ? '只看倒数项，你怎样说明它的求导依据？' : options.textMd;

  const service = new TutorService({
    sessions,
    runTurn: (params) => {
      turns.push({ sessionId: params.sessionId, requestId: params.requestId, payloadHash: params.payloadHash });
      return Promise.resolve({ status: outcome, textMd: outcome === 'committed' ? textMd : null, notice: outcome === 'committed' ? '' : '本轮未产生可展示内容' });
    },
    recordProbe: (params) => {
      probes.push({ sessionId: params.sessionId, taskId: params.taskId });
      return Promise.resolve();
    },
  });

  return { service, sessions, turns, probes };
}

describe('submitTurn：读取与校验', () => {
  it('会话不存在时抛 NotFound', async () => {
    const { service } = createHarness();
    await expect(service.submitTurn(turnInput())).rejects.toMatchObject({ status: 404 });
  });

  it('版本不一致时抛版本冲突且不触达编排器', async () => {
    const { service, sessions, turns } = createHarness();
    sessions.seed(session({ version: 7 }));

    await expect(service.submitTurn(turnInput({ expected_version: 1 }))).rejects.toBeInstanceOf(SessionVersionConflictError);
    // 关键：冲突在进入模型调用之前就被拦下，不产生无谓的算力消耗。
    expect(turns).toEqual([]);
  });

  it('非 study 阶段拒绝教学轮——检验阶段不得混入教学帮助', async () => {
    const { service, sessions, turns } = createHarness();
    sessions.seed(session({ phase: 'check_answer' }));

    await expect(service.submitTurn(turnInput())).rejects.toMatchObject({ status: 404 });
    expect(turns).toEqual([]);
  });

  it('请求体经严格 Schema 解析，未知字段被拒', () => {
    const parsed = TurnInputSchema.safeParse({ ...turnInput(), extra: 'x' });
    expect(parsed.success).toBe(false);
  });

  it('非法 action 被拒', () => {
    expect(TurnInputSchema.safeParse({ ...turnInput(), action: '不存在的动作' }).success).toBe(false);
  });
});

describe('submitTurn：提交成功', () => {
  it('追加学生与老师两条消息并推进版本', async () => {
    const { service, sessions } = createHarness();
    sessions.seed(session());

    const view = await service.submitTurn(turnInput());

    expect(view.version).toBe(2);
    expect(view.messages).toHaveLength(2);
    expect(view.messages[0]?.role).toBe('student');
    expect(view.messages[1]?.role).toBe('teacher');
    expect(view.messages[1]?.text_md).toBe('只看倒数项，你怎样说明它的求导依据？');
  });

  it('返回的视图满足 StudentView 契约', async () => {
    const { service, sessions } = createHarness();
    sessions.seed(session());

    const view = await service.submitTurn(turnInput());

    // 用契约本身校验投影结果，而不是拼一个假的 source 去调投影函数。
    const parsed = StudentViewSchema.safeParse(view);
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
    expect(Object.keys(view)).not.toContain('rationale');
  });

  it('提交后记录一次真实曝光——探针记账必须发生在提交之后', async () => {
    const { service, sessions, probes } = createHarness();
    sessions.seed(session());

    await service.submitTurn(turnInput());

    expect(probes).toEqual([{ sessionId: SESSION_ID, taskId: problem.id }]);
  });

  it('同一 request_id 重复提交沿用同一幂等键', async () => {
    const { service, sessions, turns } = createHarness();
    sessions.seed(session());

    await service.submitTurn(turnInput({ request_id: 'req-fixed' }));
    await service.submitTurn(turnInput({ request_id: 'req-fixed', expected_version: 2 }));

    // 两次调用产生相同的 payloadHash 前缀特征：request_id 由调用方控制，
    // 服务端据此识别重放（真实幂等判定在 StorePort，见 test/workflows/）。
    expect(turns).toHaveLength(2);
    expect(turns[0]?.requestId).toBe('req-fixed');
    expect(turns[1]?.requestId).toBe('req-fixed');
  });

  it('payloadHash 覆盖 action 与 text_md——不同内容不得被当作重放', async () => {
    const { service, sessions, turns } = createHarness();
    sessions.seed(session());

    await service.submitTurn(turnInput({ text_md: '第一步' }));
    await service.submitTurn(turnInput({ text_md: '完全不同的一步', expected_version: 2 }));

    expect(turns[0]?.payloadHash).not.toBe(turns[1]?.payloadHash);
  });
});

describe('submitTurn：提交失败', () => {
  it('未提交时不追加任何消息、不推进版本、不记曝光', async () => {
    const { service, sessions, probes } = createHarness({ outcome: 'rejected' });
    sessions.seed(session());

    const view = await service.submitTurn(turnInput());

    expect(view.version).toBe(1);
    expect(view.messages).toHaveLength(0);
    expect(probes).toEqual([]);
    expect(view.run_status).toBe('failed');
  });

  it('未提交时给出中性说明而非空响应', async () => {
    const { service, sessions } = createHarness({ outcome: 'rejected' });
    sessions.seed(session());

    const view = await service.submitTurn(turnInput());
    expect(view.notice.length).toBeGreaterThan(0);
  });

  it('提交成功但文本为空时不写入老师消息', async () => {
    const { service, sessions, probes } = createHarness({ textMd: null });
    sessions.seed(session());

    const view = await service.submitTurn(turnInput());

    expect(view.messages).toHaveLength(0);
    expect(view.version).toBe(1);
    expect(probes).toEqual([]);
  });
});

describe('InMemoryTutorSessionPort', () => {
  it('版本不一致时拒绝保存', async () => {
    const sessions = new InMemoryTutorSessionPort();
    sessions.seed(session({ version: 3 }));

    expect(await sessions.save(session({ version: 4 }), 1)).toBe(false);
    expect(await sessions.save(session({ version: 4 }), 3)).toBe(true);
  });

  it('未登记过的会话可直接保存', async () => {
    const sessions = new InMemoryTutorSessionPort();
    expect(await sessions.save(session(), 1)).toBe(true);
    expect(await sessions.load(SESSION_ID)).not.toBeNull();
  });
});
