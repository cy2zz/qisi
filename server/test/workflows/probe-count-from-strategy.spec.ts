// 探针计数按**本轮策略**的目标解析，而不是由调用方预烘焙。
//
// 规格依据 contracts/README.md §7 与 AGENTS.md §6 第 5 条：每个规范目标最多两次
// 真实显示的探针，模型不得靠换 goal_key 绕过。gateTurn 用这个数判定，而它取自
// canonical goal —— canonical goal 又是 strategy.focus_goal_key 的函数。
//
// 因此调用方在 turn() **之前**根本无从知道该填几：模型会聚焦哪个目标，要等策略
// 节点产出。此前 TurnCommand.probesShownForFocusGoal 是 number，调用方只能填常数
// （现有测试填 0），等于把上限关掉。这与 2ab65bd / a0730a4 修掉的
// 「策略/表达/守卫输入预烘焙」是同一类缺陷：值依赖上游产出，却由调用方在之前给。

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { PacketSchema, type GuardResult, type Packet } from '../../src/contracts/domain.schema.js';
import { FixtureProvider } from '../../src/model/fixture.provider.js';
import { MemoryStore } from '../../src/workflows/memory-store.js';
import { WorkflowOrchestrator } from '../../src/workflows/orchestrator.js';
import { projectGuardInput, projectRendererInput, projectStrategyInput, type SessionContext } from '../../src/agents/context.js';

const fixturesDirectory = path.resolve(import.meta.dirname, '..', '..', '..', 'qisi-sdd-v3', 'fixtures');
const read = <T>(name: string): T => JSON.parse(readFileSync(path.join(fixturesDirectory, name), 'utf8')) as T;

const packet = PacketSchema.parse(read<Packet>('packet.json'));
const problem = read<SessionContext['problem']>('problem.json');
const sessionFixture = read<{ submissions: SessionContext['submissions'] }>('session.json');
const diagnosisFixture = read<SessionContext['diagnosis']>('diagnosis.json');
const strategyFixture = read<SessionContext['strategy']>('strategy.json');
const guardFixture = read<GuardResult>('guard.json');

const SESSION_ID = 'session-probe-count';

/** 与夹具不同的一份策略：聚焦 d3 且探针指向 d3，用于证明计数按**产出**解析。 */
const PRODUCED_FOCUS_GOAL = 'self-001:d3';

function context(): SessionContext {
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

async function runTurn(params: {
  readonly producedStrategy?: SessionContext['strategy'];
  readonly shownProbesFor: (strategy: { readonly focus_goal_key: string }) => number;
}) {
  const sessionContext = context();
  const store = new MemoryStore();
  store.seedSession(SESSION_ID, 1);

  const fixture = new FixtureProvider();
  fixture.enqueue('diagnosis', { id: 'd1', parsed: diagnosisFixture });
  fixture.enqueue('strategy', { id: 's1', parsed: params.producedStrategy ?? strategyFixture });
  fixture.enqueue('renderer', { id: 'r1', parsed: { text_md: '只看倒数项，你怎样说明它的求导依据？' } });
  fixture.enqueue('guard', { id: 'g1', parsed: guardFixture });

  const orchestrator = new WorkflowOrchestrator(store, fixture, {
    models: {
      preparation: 'm-prep',
      diagnosis: 'm-diag',
      strategy: 'm-strat',
      assessment: 'm-assess',
      renderer: 'm-render',
      guard: 'm-guard',
    },
    configHash: 'config-probe-count',
  });

  return orchestrator.turn({
    sessionId: SESSION_ID,
    requestId: 'req-probe',
    payloadHash: 'hash-probe',
    expectedVersion: 1,
    diagnosisInput: {
      task_id: packet.problem_id,
      prompt_md: problem.statement_md,
      decisions: packet.decisions,
      routes: packet.routes,
      confirmed_evidence: sessionFixture.submissions,
      previous_hypotheses: [],
      previous_probes: [],
      private_reference_md: packet.reference_md,
    },
    routeReviewInput: null,
    buildStrategyInput: (diagnosis) => ({ ...projectStrategyInput(sessionContext), diagnosis }),
    buildRendererInput: (strategy) => projectRendererInput({ ...sessionContext, strategy }, strategy.allowed_facts),
    buildGuardInput: (strategy, candidate) =>
      projectGuardInput(
        sessionContext,
        'message',
        candidate,
        strategy.allowed_disclosures,
        strategy.reserved_decisions,
      ),
    knownDecisionIds: new Set(packet.decisions.map((decision) => decision.id)),
    knownGoalKeys: new Set(packet.decisions.map((decision) => decision.goal_key)),
    shownProbesFor: params.shownProbesFor,
  });
}

describe('探针计数按本轮策略解析', () => {
  it('解析函数拿到的是本轮产出的 focus_goal_key，而不是调用方提前知道的值', async () => {
    const seen: string[] = [];
    // 让策略节点产出一份聚焦 d3 的策略。调用方无法预知这一点——
    // 它只能从**产出**里读，这正是把 number 换成函数的原因。
    const produced: SessionContext['strategy'] = {
      ...strategyFixture,
      focus_goal_key: PRODUCED_FOCUS_GOAL,
      probe: strategyFixture.probe === null ? null : { ...strategyFixture.probe, goal_key: PRODUCED_FOCUS_GOAL },
    };

    const outcome = await runTurn({
      producedStrategy: produced,
      shownProbesFor: (strategy) => {
        seen.push(strategy.focus_goal_key);
        return 0;
      },
    });

    expect(outcome.status).toBe('committed');
    expect(seen, '解析函数未被调用，或拿到的不是本轮产出的目标').toContain(PRODUCED_FOCUS_GOAL);
    expect(seen).not.toContain(strategyFixture.focus_goal_key);
  });

  it('该目标已显示两次时，本轮探针被拒——上限真的生效', async () => {
    const outcome = await runTurn({ shownProbesFor: () => 2 });

    expect(outcome.status).toBe('rejected');
    const decision = outcome.decision;
    if (decision === undefined || decision.approved) {
      throw new Error(`期望被拒（PROBE_LIMIT_REACHED），实际：${JSON.stringify(decision)}`);
    }
    expect(decision.code).toBe('PROBE_LIMIT_REACHED');
  });

  it('对照：同一份策略在计数为 0 时通过——证明上一条的拒绝来自计数', async () => {
    const outcome = await runTurn({ shownProbesFor: () => 0 });

    expect(outcome.status).toBe('committed');
  });
});
