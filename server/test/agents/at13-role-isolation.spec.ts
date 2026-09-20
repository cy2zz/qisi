// AT13｜四角色独立契约与提示节点（B01 直接验收项）
//
// 验收口径（qisi-sdd-v3/acceptance/cases.json，layer: unit）：
//   Given 四角色入口与 FixtureProvider
//   When  分别运行 prepare / turn / grade
//   Then  真实经过对应独立契约与提示节点，**不是一调用伪造四阶段**
//
// 证据落点：artifacts/acceptance/AT13.json（该目录归 A01 建立，见交接项）。
// 本文件只提供可执行断言；FixtureProvider 的结论不等于真实模型质量，
// 也不代表 A 的 Assessment 评分业务已完成——本测试中的 Assessment 是显式替身。

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AssessmentOutputSchema,
  GuardResultSchema,
  PacketSchema,
  RoutePatchSchema,
  type AssessmentInput,
  type Diagnosis,
  type GuardResult,
  type Packet,
  type Strategy,
} from '../../src/contracts/domain.schema.js';
import { AGENT_ROLES, ROLE_PROMPTS } from '../../src/prompts/index.js';
import { FixtureProvider } from '../../src/model/fixture.provider.js';
import { MemoryStore } from '../../src/workflows/memory-store.js';
import { WorkflowOrchestrator } from '../../src/workflows/orchestrator.js';
import { projectAssessmentInput, projectDiagnosisInput, projectGuardInput, projectPreparationInput, projectRendererInput, projectStrategyInput, type SessionContext } from '../../src/agents/context.js';
import type { AssessmentAdapter } from '../../src/agents/assessment-port.js';
import { AssessmentNotConfiguredError } from '../../src/agents/assessment-port.js';

const fixturesDirectory = path.resolve(import.meta.dirname, '..', '..', '..', 'qisi-sdd-v3', 'fixtures');

function readFixture<T>(fileName: string): T {
  return JSON.parse(readFileSync(path.join(fixturesDirectory, fileName), 'utf8')) as T;
}

const packet = readFixture<Packet>('packet.json');
const diagnosisFixture = readFixture<Diagnosis>('diagnosis.json');
const strategyFixture = readFixture<Strategy>('strategy.json');
const guardFixture = readFixture<GuardResult>('guard.json');
const assessmentFixture = AssessmentOutputSchema.parse(readFixture('assessment-output.json'));
const problem = readFixture<SessionContext['problem']>('problem.json');
const sessionFixture = readFixture<{ submissions: SessionContext['submissions'] }>('session.json');

const SESSION_ID = 'session-at13';

function createSessionContext(): SessionContext {
  return {
    taskId: packet.problem_id,
    problem,
    referenceMaterialMd: packet.reference_md,
    studentRouteMd: null,
    submissions: sessionFixture.submissions,
    previousHypotheses: [],
    previousProbes: [],
    decisions: packet.decisions,
    routes: packet.routes,
    privateReferenceMd: packet.reference_md,
    diagnosis: diagnosisFixture,
    userAction: '我不确定这一行为什么错',
    exposures: [],
    remainingProbes: 2,
    remainingCalls: 6,
    routePatch: null,
    publicPromptMd: problem.statement_md,
    publicHistoryMd: [],
    strategy: strategyFixture,
    checkTask: packet.check_tasks[0] as SessionContext['checkTask'],
    lockedPlanMd: 'P=2(x+9/x)',
    finalAnswerMd: '最小值 6',
    guardReferenceMd: packet.reference_md,
  };
}

/** 装配一次完整的 prepare + turn + grade，返回夹具与编排器。 */
function assemble() {
  const context = createSessionContext();
  const store = new MemoryStore();
  store.seedSession(SESSION_ID, 1);

  const provider = new FixtureProvider();
  provider.enqueue('preparation', { id: 'prepare-packet', parsed: packet });
  // route_review 仅在诊断提出时消费；预先入队以免 MissingFixtureError 掩盖真实断言。
  provider.enqueue('preparation', {
    id: 'route-review-patch',
    parsed: RoutePatchSchema.parse({
      task_id: packet.problem_id,
      new_decisions: [],
      new_routes: [],
      evidence_refs: [],
      math_status: 'valid',
      verification: [{ kind: 'deterministic_check', reviewer_or_model: 'fixture', reference: '', summary: '', status: 'pass', checked_at: new Date().toISOString() }],
      blocking_issues: [],
    }),
  });
  provider.enqueue('diagnosis', { id: 'diagnosis-1', parsed: diagnosisFixture });
  provider.enqueue('strategy', { id: 'strategy-1', parsed: strategyFixture });
  provider.enqueue('renderer', { id: 'renderer-1', parsed: { text_md: '只看倒数项，你怎样说明它的求导依据？' } });
  provider.enqueue('guard', { id: 'guard-1', parsed: guardFixture });
  provider.enqueue('renderer', { id: 'renderer-rewrite', parsed: { text_md: '重写后的问句' } });
  provider.enqueue('guard', { id: 'guard-2', parsed: guardFixture });

  const orchestrator = new WorkflowOrchestrator(store, provider, {
    models: {
      preparation: 'fixture-prep',
      diagnosis: 'fixture-diag',
      strategy: 'fixture-strat',
      assessment: 'fixture-assess',
      renderer: 'fixture-render',
      guard: 'fixture-guard',
    },
    configHash: 'config-at13',
  });

  const assessment: AssessmentAdapter = {
    implementation: 'provisional',
    isTestDouble: true,
    agent: {
      role: 'assessment',
      promptVersion: ROLE_PROMPTS.assessment.version,
      run: (input: AssessmentInput) => Promise.resolve({ ...assessmentFixture, task_id: input.task.id }),
    },
  };

  return { context, store, provider, orchestrator, assessment };
}

describe('AT13：四角色经过各自的契约与提示节点', () => {
  it('prepare / turn / grade 分别运行且都产生独立调用', async () => {
    const { context, store, orchestrator, assessment } = assemble();

    const prepared = await orchestrator.prepare({
      sessionId: SESSION_ID,
      requestId: 'req-prepare',
      payloadHash: 'hash-prepare',
      expectedVersion: 1,
      preparationInput: projectPreparationInput(context, 'prepare'),
      trustedVerificationReferences: new Set(['自拟开发夹具']),
    });
    expect(prepared.status).toBe('committed');
    const preparedPacket = PacketSchema.parse(prepared.value);
    expect(preparedPacket.problem_id).toBe(packet.problem_id);

    const turn = await orchestrator.turn({
      sessionId: SESSION_ID,
      requestId: 'req-turn',
      payloadHash: 'hash-turn',
      expectedVersion: store.sessionVersion(SESSION_ID),
      diagnosisInput: projectDiagnosisInput(context),
      routeReviewInput: projectPreparationInput(context, 'route_review'),
      // 策略输入必须由本轮诊断构造，不能用夹具里预先烘焙的诊断。
      buildStrategyInput: (diagnosis) => ({ ...projectStrategyInput(context), diagnosis }),
      rendererInput: projectRendererInput(context, strategyFixture.allowed_facts),
      guardInput: projectGuardInput(context, 'message', { text_md: '' }, strategyFixture.allowed_disclosures, strategyFixture.reserved_decisions),
      knownDecisionIds: new Set(packet.decisions.map((decision) => decision.id)),
      knownGoalKeys: new Set(packet.decisions.map((decision) => decision.goal_key)),
      probesShownForFocusGoal: 0,
    });
    expect(turn.status).toBe('committed');
    expect(turn.value?.diagnosis.task_id).toBe(diagnosisFixture.task_id);

    const graded = await orchestrator.grade({
      sessionId: SESSION_ID,
      requestId: 'req-grade',
      payloadHash: 'hash-grade',
      expectedVersion: store.sessionVersion(SESSION_ID),
      assessmentInput: projectAssessmentInput(context),
      assessment,
    });
    expect(graded.status).toBe('committed');
    expect(graded.value?.planning).toBe('correct');
  });

  it('调用记录证明不是"一次调用伪造四阶段"', async () => {
    const { context, store, provider, orchestrator, assessment } = assemble();

    await orchestrator.prepare({
      sessionId: SESSION_ID,
      requestId: 'req-prepare',
      payloadHash: 'hash-prepare',
      expectedVersion: 1,
      preparationInput: projectPreparationInput(context, 'prepare'),
      trustedVerificationReferences: new Set(['自拟开发夹具']),
    });
    await orchestrator.turn({
      sessionId: SESSION_ID,
      requestId: 'req-turn',
      payloadHash: 'hash-turn',
      expectedVersion: store.sessionVersion(SESSION_ID),
      diagnosisInput: projectDiagnosisInput(context),
      routeReviewInput: null,
      // 策略输入必须由本轮诊断构造，不能用夹具里预先烘焙的诊断。
      buildStrategyInput: (diagnosis) => ({ ...projectStrategyInput(context), diagnosis }),
      rendererInput: projectRendererInput(context, strategyFixture.allowed_facts),
      guardInput: projectGuardInput(context, 'message', {}, [], []),
      knownDecisionIds: new Set(packet.decisions.map((decision) => decision.id)),
      knownGoalKeys: new Set(packet.decisions.map((decision) => decision.goal_key)),
      probesShownForFocusGoal: 0,
    });
    await orchestrator.grade({
      sessionId: SESSION_ID,
      requestId: 'req-grade',
      payloadHash: 'hash-grade',
      expectedVersion: store.sessionVersion(SESSION_ID),
      assessmentInput: projectAssessmentInput(context),
      assessment,
    });

    // 1) 经过的 role 互不相同且覆盖四个产品角色
    const roles = new Set(provider.roleSequence);
    for (const role of ['preparation', 'diagnosis', 'strategy', 'renderer', 'guard'] as const) {
      expect(roles.has(role), `未经过 ${role} 角色入口`).toBe(true);
    }

    // 2) 每个 role 的 system 就是该角色自己的提示，不是共享的一段文字
    const systemsByRole = new Map(provider.calls.map((call) => [call.role, call.systemDigest]));
    expect(new Set(systemsByRole.values()).size).toBe(systemsByRole.size);

    // 3) 各角色的上下文投影确实不同（input 摘要互异）
    const inputsByRole = new Map(provider.calls.map((call) => [call.role, call.inputDigest]));
    expect(new Set(inputsByRole.values()).size).toBe(inputsByRole.size);

    // 4) 调用总数远多于 1，说明确实是多节点而非单次调用
    expect(provider.calls.length).toBeGreaterThanOrEqual(4);
  });

  it('六份角色提示互不相同，任一角色都不是另一角色的改名', () => {
    const bodies = AGENT_ROLES.map((role) => ROLE_PROMPTS[role].body);
    expect(new Set(bodies).size).toBe(AGENT_ROLES.length);
  });
});

describe('AT13：角色上下文边界', () => {
  it('Assessment 输入不含历史诊断、画像或教师标签', () => {
    const context = createSessionContext();
    const input = projectAssessmentInput(context);

    // 只有三个字段：检验题本身、锁定计划、最终答案。
    expect(Object.keys(input).sort()).toEqual(['final_answer_md', 'locked_plan_md', 'task']);

    // 即便原始会话里存在诊断与策略，也不得出现在 Assessment 输入中。
    const serialised = JSON.stringify(input);
    expect(serialised).not.toContain('self-001:d1');
    expect(serialised).not.toContain(strategyFixture.focus_goal_key);
    expect(serialised).not.toContain('hypotheses');
  });

  it('未确认或已失效的提交不进入 Diagnosis 输入', () => {
    const context = createSessionContext();
    const withUnconfirmed: SessionContext = {
      ...context,
      submissions: [
        ...context.submissions,
        { ...context.submissions[0]!, id: 's-unconfirmed', confirmed: false },
        { ...context.submissions[0]!, id: 's-invalidated', invalidated: true },
      ],
    };

    const input = projectDiagnosisInput(withUnconfirmed);
    const ids = input.confirmed_evidence.map((submission) => submission.id);
    expect(ids).toContain('s1');
    expect(ids).not.toContain('s-unconfirmed');
    expect(ids).not.toContain('s-invalidated');
  });

  it('Renderer 输入不含完整私有参考或未来 rubric', () => {
    const context = createSessionContext();
    const input = projectRendererInput(context, strategyFixture.allowed_facts);

    // 先证明"未来 rubric 确实存在于会话中"，否则下面的 not.toContain 是空转。
    const futureRubric = packet.check_tasks[0]?.execution_rubric;
    expect(futureRubric, '夹具缺少 check_tasks[0].execution_rubric，断言会退化为空转').toBeTruthy();

    const serialised = JSON.stringify(input);
    expect(serialised).not.toContain(futureRubric as string);
    expect(serialised).not.toContain('planning_rubric');
    expect(input.question_md).toBe(context.strategy.probe?.question_md ?? null);
  });
});

describe('AT13：Assessment 未装配时显式失败', () => {
  it('非测试运行不得静默降级为替身', async () => {
    const { store, orchestrator, context } = assemble();
    await expect(
      orchestrator.grade({
        sessionId: SESSION_ID,
        requestId: 'req-grade',
        payloadHash: 'hash-grade',
        expectedVersion: store.sessionVersion(SESSION_ID),
        assessmentInput: projectAssessmentInput(context),
        assessment: null,
      }),
    ).rejects.toBeInstanceOf(AssessmentNotConfiguredError);
  });
});

describe('AT13：单角色输出不合格不得被其他角色补成成功', () => {
  it('Diagnosis 结构非法时整个 turn 失败，不产生提交', async () => {
    const { store, provider, context, orchestrator } = assemble();
    provider.reset();
    provider.enqueue('diagnosis', { id: 'bad-diagnosis', parsed: { task_id: 'x' } });

    await expect(
      orchestrator.turn({
        sessionId: SESSION_ID,
        requestId: 'req-turn',
        payloadHash: 'hash-turn',
        expectedVersion: store.sessionVersion(SESSION_ID),
        diagnosisInput: projectDiagnosisInput(context),
        routeReviewInput: null,
        // 策略输入必须由本轮诊断构造，不能用夹具里预先烘焙的诊断。
      buildStrategyInput: (diagnosis) => ({ ...projectStrategyInput(context), diagnosis }),
        rendererInput: projectRendererInput(context, []),
        guardInput: projectGuardInput(context, 'message', {}, [], []),
        knownDecisionIds: new Set(packet.decisions.map((decision) => decision.id)),
        knownGoalKeys: new Set(packet.decisions.map((decision) => decision.goal_key)),
        probesShownForFocusGoal: 0,
      }),
    ).rejects.toThrowError(/diagnosis/);

    // 未产生任何公开提交：会话版本不变，活动 run 已释放。
    expect(store.sessionVersion(SESSION_ID)).toBe(1);
    expect(store.lastSafeMessage(SESSION_ID)).toBeNull();
  });

  it('Guard 拒绝且无重写额度时不提交', async () => {
    const { store, provider, context, orchestrator } = assemble();
    provider.reset();
    provider.enqueue('diagnosis', { id: 'd', parsed: diagnosisFixture });
    provider.enqueue('strategy', { id: 's', parsed: strategyFixture });
    provider.enqueue('renderer', { id: 'r', parsed: { text_md: '候选文本' } });
    const rejected = GuardResultSchema.parse({ ...guardFixture, verdict: 'revise', issues: ['暗示了完整策略'] });
    provider.enqueue('guard', { id: 'g-reject', parsed: rejected });
    // 重写额度被预先占用，模拟同一 run 内已用过一次重写。
    provider.enqueue('renderer', { id: 'r2', parsed: { text_md: '重写候选' } });
    provider.enqueue('guard', { id: 'g-reject-2', parsed: rejected });

    const outcome = await orchestrator.turn({
      sessionId: SESSION_ID,
      requestId: 'req-turn',
      payloadHash: 'hash-turn',
      expectedVersion: store.sessionVersion(SESSION_ID),
      diagnosisInput: projectDiagnosisInput(context),
      routeReviewInput: null,
      // 策略输入必须由本轮诊断构造，不能用夹具里预先烘焙的诊断。
      buildStrategyInput: (diagnosis) => ({ ...projectStrategyInput(context), diagnosis }),
      rendererInput: projectRendererInput(context, []),
      guardInput: projectGuardInput(context, 'message', {}, [], []),
      knownDecisionIds: new Set(packet.decisions.map((decision) => decision.id)),
      knownGoalKeys: new Set(packet.decisions.map((decision) => decision.goal_key)),
      probesShownForFocusGoal: 0,
    });

    expect(outcome.status).toBe('rejected');
    expect(store.lastSafeMessage(SESSION_ID)).toBeNull();
    expect(store.sessionVersion(SESSION_ID)).toBe(1);
  });
});
