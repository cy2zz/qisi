// AT27｜Renderer 输入构造不含完整解法、未来 rubric 与私有诊断原文。
//
// 验收口径（acceptance/cases.json，layer: unit）：
//   Given Renderer输入构造
//   When  查看最终模型请求
//   Then  不含完整解法、未来rubric和私有诊断原文
//
// 与 AT13「四角色独立」的区别：AT13 断言**经过了**独立的契约与提示节点；
// AT27 断言发往 Renderer 的**内容本身**没有越界。前者是流程，后者是数据。
//
// 因此本文件不看投影结果，而是抓取真实发往 provider 的请求体——
// 投影正确但请求体超范围，同样算泄露，且更危险（模型会照着说出去）。

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { PacketSchema, type GuardResult, type Packet } from '../../src/contracts/domain.schema.js';
import { FixtureProvider } from '../../src/model/fixture.provider.js';
import type { ModelPort, ModelRequest, ModelResponse } from '../../src/model/ports.js';
import { MemoryStore } from '../../src/workflows/memory-store.js';
import { WorkflowOrchestrator } from '../../src/workflows/orchestrator.js';
import { projectGuardInput, projectRendererInput, type SessionContext } from '../../src/agents/context.js';

const fixturesDirectory = path.resolve(import.meta.dirname, '..', '..', '..', 'qisi-sdd-v3', 'fixtures');
const read = <T>(name: string): T => JSON.parse(readFileSync(path.join(fixturesDirectory, name), 'utf8')) as T;

const packet = PacketSchema.parse(read<Packet>('packet.json'));
const problem = read<SessionContext['problem']>('problem.json');
const sessionFixture = read<{ submissions: SessionContext['submissions'] }>('session.json');
const diagnosisFixture = read<SessionContext['diagnosis']>('diagnosis.json');
const strategyFixture = read<SessionContext['strategy']>('strategy.json');
const guardFixture = read<GuardResult>('guard.json');

const SESSION_ID = 'session-at27';

/** 记录每个 role 实际收到的完整请求体——AT27 的断言对象就是这个。 */
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

function createContext(): SessionContext {
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

async function runTurnAndCapture(diagnosisOverride?: unknown) {
  const context = createContext();
  const store = new MemoryStore();
  store.seedSession(SESSION_ID, 1);

  const fixture = new FixtureProvider();
  fixture.enqueue('diagnosis', { id: 'd1', parsed: diagnosisOverride ?? diagnosisFixture });
  fixture.enqueue('strategy', { id: 's1', parsed: strategyFixture });
  fixture.enqueue('renderer', { id: 'r1', parsed: { text_md: '只看倒数项，你怎样说明它的求导依据？' } });
  fixture.enqueue('guard', { id: 'g1', parsed: guardFixture });

  const provider = new RecordingProvider(fixture);
  const orchestrator = new WorkflowOrchestrator(store, provider, {
    models: {
      preparation: 'm-prep',
      diagnosis: 'm-diag',
      strategy: 'm-strat',
      assessment: 'm-assess',
      renderer: 'm-render',
      guard: 'm-guard',
    },
    configHash: 'config-at27',
  });

  await orchestrator.turn({
    sessionId: SESSION_ID,
    requestId: 'req-turn',
    payloadHash: 'hash-turn',
    expectedVersion: 1,
    diagnosisInput: { task_id: packet.problem_id, prompt_md: problem.statement_md, decisions: packet.decisions, routes: packet.routes, confirmed_evidence: sessionFixture.submissions, previous_hypotheses: [], previous_probes: [], private_reference_md: packet.reference_md },
    routeReviewInput: null,
    // 策略输入由本轮诊断构造——诊断字段用产出的，不用夹具里那份。
    buildStrategyInput: (diagnosis) => ({
      diagnosis,
      user_action: context.userAction,
      exposures: [],
      remaining_probes: 2,
      remaining_calls: 6,
      route_patch: null,
      decisions: packet.decisions,
      private_reference_md: packet.reference_md,
    }),
    buildRendererInput: (strategy) => projectRendererInput({ ...context, strategy }, strategyFixture.allowed_facts),
    buildGuardInput: (strategy, candidate) =>
      projectGuardInput(context, 'message', candidate, strategyFixture.allowed_disclosures, strategyFixture.reserved_decisions),
    knownDecisionIds: new Set(packet.decisions.map((decision) => decision.id)),
    knownGoalKeys: new Set(packet.decisions.map((decision) => decision.goal_key)),
    shownProbesFor: () => 0,
  });

  return provider;
}

describe('AT27：发往 Renderer 的请求不含越界内容', () => {
  it('真实产生了 Renderer 调用', async () => {
    const provider = await runTurnAndCapture();
    expect(provider.forRole('renderer')).toBeDefined();
  });

  it('请求体中不含完整私有解法（private_reference_md / reference_md）', async () => {
    const provider = await runTurnAndCapture();
    const renderer = provider.forRole('renderer');
    const serialised = JSON.stringify(renderer);

    expect(serialised).not.toContain('private_reference_md');
    expect(serialised).not.toContain('reference_md');
    // 私有参考的正文本身也不得出现——字段名被改掉不算修好。
    expect(serialised).not.toContain(packet.reference_md);
  });

  it('请求体中不含未来检验题的 rubric', async () => {
    const provider = await runTurnAndCapture();
    const serialised = JSON.stringify(provider.forRole('renderer'));

    const checkTask = packet.check_tasks[0];
    expect(checkTask?.execution_rubric).toBeTruthy();
    expect(checkTask?.planning_rubric).toBeTruthy();

    expect(serialised).not.toContain('planning_rubric');
    expect(serialised).not.toContain('execution_rubric');
    expect(serialised).not.toContain(checkTask?.execution_rubric as string);
    expect(serialised).not.toContain(checkTask?.planning_rubric as string);
    // 检验题题干同样不得提前出现。
    expect(serialised).not.toContain(checkTask?.prompt_md as string);
  });

  it('请求体中不含私有诊断原文', async () => {
    const provider = await runTurnAndCapture();
    const serialised = JSON.stringify(provider.forRole('renderer'));

    expect(serialised).not.toContain('hypotheses');
    expect(serialised).not.toContain('judgment');
    // 诊断假设的解释文本不得出现。
    // 先证明假设解释确实存在，否则下一条断言会退化为空转。
    const hypothesisExplanation = diagnosisFixture.hypotheses[0]?.explanation;
    expect(hypothesisExplanation, '夹具缺少 hypotheses[0].explanation，断言会退化').toBeTruthy();
    expect(serialised).not.toContain(hypothesisExplanation as string);

    // 作为对照：Diagnosis 角色**确实**收到了这些内容——说明上一条不是因为数据不存在。
    const diagnosisSerialised = JSON.stringify(provider.forRole('diagnosis'));
    expect(diagnosisSerialised).toContain('hypotheses');
  });

  it('Renderer 请求只携带公开字段', async () => {
    const provider = await runTurnAndCapture();
    const renderer = provider.forRole('renderer');
    const input = renderer?.input as Record<string, unknown>;

    expect(Object.keys(input).sort()).toEqual(
      [
        'action',
        'approved_facts',
        'expected_student_artifact',
        'intervention',
        'public_history_md',
        'public_prompt_md',
        'question_md',
        'scaffold_level',
        'task_id',
      ].sort(),
    );
  });

  it('Renderer 请求不含决策图的策略字段', async () => {
    const provider = await runTurnAndCapture();
    const serialised = JSON.stringify(provider.forRole('renderer'));

    // 这些字段描述教学策略与评分口径，泄露等于把路线交给学生。
    for (const field of ['acceptance_rule', 'entry_condition', 'expected_artifact', 'common_gaps', 'prerequisite_ids']) {
      expect(serialised, `Renderer 请求泄露了 ${field}`).not.toContain(field);
    }
  });

  it('Diagnosis 请求不含未来检验内容（对照 AT13 的上下文边界）', async () => {
    const provider = await runTurnAndCapture();
    const serialised = JSON.stringify(provider.forRole('diagnosis'));
    expect(serialised).not.toContain('execution_rubric');
    expect(serialised).not.toContain('locked_plan_md');
  });
});

describe('策略输入必须来自本轮诊断，而非调用方预先烘焙的那份', () => {
  it('策略节点收到的是本轮产出的诊断', async () => {
    // 让 provider 返回一份**与夹具不同**的诊断。若 turn() 仍把调用方预构造的
    // StrategyInput 原样传给策略节点，这条断言就会失败——这正是修复前的缺陷。
    const producedMarkdown = '本轮产出的诊断标记-7f3a';
    const produced = { ...diagnosisFixture, summary: producedMarkdown };

    const provider = await runTurnAndCapture(produced);

    const strategyRequest = provider.forRole('strategy');
    expect(strategyRequest, '未产生 strategy 调用').toBeDefined();
    const serialised = JSON.stringify(strategyRequest?.input);
    expect(serialised).toContain(producedMarkdown);

    // 对照：夹具里那份诊断的 summary 不应被当成本轮诊断送进去。
    expect(serialised).not.toContain(diagnosisFixture.summary);
  });
});
