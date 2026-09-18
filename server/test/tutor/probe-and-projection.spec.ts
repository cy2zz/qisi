// B03 教学轮核心规则：规范目标推导、探针计数、StudentView 白名单投影。
//
// 规格依据：
//   contracts/README.md §7「canonical_goal_key从task_id+稳定目标登记表产生，补偿节点
//     parent_goal_key 映射到相同未决目标。模型不可自己新建key逃避计数。最多两次真实
//     显示的诊断探针；失败/没显示的不虚增，但已经显示之后修改输入也不归零。」
//   contracts/README.md §2「StudentView、Report是白名单投影，从零构造；禁止使用展开
//     运算符复制私有对象后删除几个字段。」
//   AGENTS.md §6 第 5 条 探针有边界。

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { DecisionSchema, GuardResultSchema, PacketSchema, ProblemSchema, StrategySchema, StudentViewSchema, type Decision, type Strategy } from '../../src/contracts/domain.schema.js';
import { CanonicalGoalRegistry, PROBE_LIMIT_PER_CANONICAL_GOAL, ProbeCounter } from '../../src/features/tutor/probe-counter.js';
import {
  allowedActionsFor,
  projectPublicGoal,
  projectPublicMessage,
  projectPublicProblem,
  projectStudentView,
  type PrivateMessage,
  type StudentViewSource,
} from '../../src/features/tutor/student-view.js';
import { TurnWorkflow } from '../../src/workflows/turn.js';

const fixturesDirectory = path.resolve(import.meta.dirname, '..', '..', '..', 'qisi-sdd-v3', 'fixtures');
const packet = PacketSchema.parse(JSON.parse(readFileSync(path.join(fixturesDirectory, 'packet.json'), 'utf8')));
const strategyFixture = StrategySchema.parse(JSON.parse(readFileSync(path.join(fixturesDirectory, 'strategy.json'), 'utf8')));
const guardFixture = GuardResultSchema.parse(JSON.parse(readFileSync(path.join(fixturesDirectory, 'guard.json'), 'utf8')));
const problem = ProblemSchema.parse(JSON.parse(readFileSync(path.join(fixturesDirectory, 'problem.json'), 'utf8')));

const TASK_ID = packet.problem_id;
const SESSION_ID = 'session-b03';

function decision(overrides: Partial<Decision> & { id: string; goal_key: string }): Decision {
  return DecisionSchema.parse({
    goal: `目标 ${overrides.id}`,
    part_id: 'p1',
    parent_goal_key: null,
    source: 'teacher',
    prerequisite_ids: [],
    entry_condition: '',
    expected_artifact: '',
    acceptance_rule: '',
    common_gaps: [],
    ...overrides,
  });
}

function withProbe(strategy: Strategy, goalKey: string): Strategy {
  return StrategySchema.parse({
    ...strategy,
    focus_goal_key: goalKey,
    probe: {
      goal_key: goalKey,
      question_md: '你怎样说明这一项的求导依据？',
      branches: [
        { hypothesis_id: 'h1', expected: '规则记反', counter_evidence: '能说清幂函数求导', next_action: '概念桥梁' },
        { hypothesis_id: 'h2', expected: '抄写失误', counter_evidence: '重复同样错误', next_action: '邀请自查' },
      ],
    },
  });
}

// ---------------------------------------------------------------------------
// 规范目标：模型不能靠换 key 重置预算
// ---------------------------------------------------------------------------

describe('canonical goal 推导', () => {
  it('同一 (task, goal_key) 恒得同一规范键', () => {
    const registry = new CanonicalGoalRegistry();
    const a = decision({ id: 'd1', goal_key: 'self-001:d1' });
    expect(registry.resolve(TASK_ID, a)).toBe(registry.resolve(TASK_ID, a));
  });

  it('不同 goal_key 得到不同规范键', () => {
    const registry = new CanonicalGoalRegistry();
    expect(registry.resolve(TASK_ID, decision({ id: 'd1', goal_key: 'g1' }))).not.toBe(
      registry.resolve(TASK_ID, decision({ id: 'd2', goal_key: 'g2' })),
    );
  });

  it('补偿节点归并到父目标——换节点名不得重置探针预算', () => {
    const registry = new CanonicalGoalRegistry();
    const parent = decision({ id: 'd1', goal_key: 'self-001:d1' });
    const parentCanonical = registry.resolve(TASK_ID, parent);

    // 两个不同的补偿节点，各自有独立 id 与 goal_key，但都指向同一父目标。
    const compensationA = decision({ id: 'comp-a', goal_key: 'self-001:d1:comp-a', parent_goal_key: 'self-001:d1' });
    const compensationB = decision({ id: 'comp-b', goal_key: 'self-001:d1:comp-b', parent_goal_key: 'self-001:d1' });

    expect(registry.resolve(TASK_ID, compensationA)).toBe(parentCanonical);
    expect(registry.resolve(TASK_ID, compensationB)).toBe(parentCanonical);
  });

  it('父目标未登记时退回自身稳定派生，不编造父键', () => {
    const registry = new CanonicalGoalRegistry();
    const orphan = decision({ id: 'x', goal_key: 'child', parent_goal_key: '从未登记过的父' });
    const canonical = registry.resolve(TASK_ID, orphan);
    expect(canonical).toMatch(/^[0-9a-f]{32}$/);
    expect(registry.resolve(TASK_ID, decision({ id: 'y', goal_key: 'child', parent_goal_key: null }))).not.toBe(canonical);
  });

  it('跨 task 的同名 goal_key 不共享规范键', () => {
    const registry = new CanonicalGoalRegistry();
    const d = decision({ id: 'd1', goal_key: 'g1' });
    expect(registry.resolve('task-A', d)).not.toBe(registry.resolve('task-B', d));
  });
});

// ---------------------------------------------------------------------------
// 探针计数
// ---------------------------------------------------------------------------

describe('探针计数', () => {
  const canonical = 'goal-canonical';

  it('上限为 2，与 runtime.json 的 probe_limit_per_canonical_goal 一致', () => {
    expect(PROBE_LIMIT_PER_CANONICAL_GOAL).toBe(2);
  });

  it('未显示过时允许提，序号由代码分配', () => {
    const counter = new ProbeCounter();
    const admission = counter.admit(SESSION_ID, TASK_ID, canonical);
    expect(admission.allowed).toBe(true);
    expect(admission.ordinal).toBe(1);
  });

  it('显示到上限后拒绝', () => {
    const counter = new ProbeCounter();
    counter.recordShown(SESSION_ID, TASK_ID, canonical);
    counter.recordShown(SESSION_ID, TASK_ID, canonical);

    const admission = counter.admit(SESSION_ID, TASK_ID, canonical);
    expect(admission.allowed).toBe(false);
    expect(admission.shownCount).toBe(2);
    expect(admission.ordinal).toBeNull();
  });

  it('计数不因修改输入而归零——已显示就是已显示', () => {
    const counter = new ProbeCounter();
    counter.recordShown(SESSION_ID, TASK_ID, canonical);
    // 模拟学生更正输入后重来：计数保持。
    expect(counter.shownCount(SESSION_ID, TASK_ID, canonical)).toBe(1);
    expect(counter.remaining(SESSION_ID, TASK_ID, canonical)).toBe(1);
  });

  it('越界记账抛错而不是静默钳制——对应 SQL 的 CHECK(shown_count BETWEEN 0 AND 2)', () => {
    const counter = new ProbeCounter();
    counter.recordShown(SESSION_ID, TASK_ID, canonical);
    counter.recordShown(SESSION_ID, TASK_ID, canonical);
    expect(() => counter.recordShown(SESSION_ID, TASK_ID, canonical)).toThrowError(/越界/);
  });

  it('不同 canonical goal 各自计数', () => {
    const counter = new ProbeCounter();
    counter.recordShown(SESSION_ID, TASK_ID, 'goal-a');
    counter.recordShown(SESSION_ID, TASK_ID, 'goal-a');
    expect(counter.admit(SESSION_ID, TASK_ID, 'goal-a').allowed).toBe(false);
    expect(counter.admit(SESSION_ID, TASK_ID, 'goal-b').allowed).toBe(true);
  });

  it('不同会话各自计数', () => {
    const counter = new ProbeCounter();
    counter.recordShown('session-1', TASK_ID, canonical);
    counter.recordShown('session-1', TASK_ID, canonical);
    expect(counter.admit('session-2', TASK_ID, canonical).allowed).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// TurnWorkflow：探针额度用尽时转为帮助而非整轮失败
// ---------------------------------------------------------------------------

describe('TurnWorkflow.gate', () => {
  const workflow = new TurnWorkflow();
  const decisions = packet.decisions;
  const focusGoalKey = decisions[0]!.goal_key;
  const knownDecisionIds = new Set(decisions.map((item) => item.id));

  function contextFor(probe: boolean) {
    return workflow.buildStrategyContext({
      sessionId: SESSION_ID,
      taskId: TASK_ID,
      decisions,
      strategy: probe ? withProbe(strategyFixture, focusGoalKey) : StrategySchema.parse({ ...strategyFixture, focus_goal_key: focusGoalKey, probe: null }),
    });
  }

  it('额度充足时允许提探针', () => {
    const context = contextFor(true);
    expect(context.probeAdmission?.allowed).toBe(true);
    expect(context.remainingProbes).toBe(2);

    const decision = workflow.gate({ strategy: withProbe(strategyFixture, focusGoalKey), guard: guardFixture, knownDecisionIds, context });
    expect(decision.approved).toBe(true);
  });

  it('额度用尽时摘掉探针但仍放行本轮——学生应得到帮助而非报错', () => {
    workflow.recordCommittedProbe({ sessionId: SESSION_ID, taskId: TASK_ID, context: contextFor(true) });
    workflow.recordCommittedProbe({ sessionId: SESSION_ID, taskId: TASK_ID, context: contextFor(true) });

    const context = contextFor(true);
    expect(context.probeAdmission?.allowed).toBe(false);

    const decision = workflow.gate({ strategy: withProbe(strategyFixture, focusGoalKey), guard: guardFixture, knownDecisionIds, context });
    expect(decision.approved).toBe(true);
    if (decision.approved) {
      expect(decision.reason).toMatch(/探针额度已用尽/);
    }
  });

  it('模型给的 focus_goal_key 不在已登记决策中时不给探针额度', () => {
    const context = workflow.buildStrategyContext({
      sessionId: SESSION_ID,
      taskId: TASK_ID,
      decisions,
      strategy: withProbe(strategyFixture, '凭空捏造的目标'),
    });
    expect(context.canonicalGoalKey).toBeNull();
    expect(context.remainingProbes).toBe(0);
    expect(context.probeAdmission).toBeNull();
  });

  it('未提交的探针不计数——Guard 拒绝不得白吃学生额度', () => {
    const fresh = new TurnWorkflow();
    const context = fresh.buildStrategyContext({
      sessionId: SESSION_ID,
      taskId: TASK_ID,
      decisions,
      strategy: withProbe(strategyFixture, focusGoalKey),
    });
    // 只判定未记账：计数应保持 0。
    expect(context.probeAdmission?.allowed).toBe(true);
    expect(fresh.probes.shownCount(SESSION_ID, TASK_ID, context.canonicalGoalKey!)).toBe(0);
  });

  it('recordCommittedProbe 在未获准时返回 null 且不计数', () => {
    const fresh = new TurnWorkflow();
    const noProbe = fresh.buildStrategyContext({
      sessionId: SESSION_ID,
      taskId: TASK_ID,
      decisions,
      strategy: StrategySchema.parse({ ...strategyFixture, focus_goal_key: focusGoalKey, probe: null }),
    });
    expect(fresh.recordCommittedProbe({ sessionId: SESSION_ID, taskId: TASK_ID, context: noProbe })).toBeNull();
  });

  it('补偿节点通过与父目标相同的规范键共用额度', () => {
    const fresh = new TurnWorkflow();
    const parent = decisions[0]!;
    const compensation = decision({ id: 'comp-1', goal_key: 'comp-1-key', parent_goal_key: parent.goal_key });
    const graph = [...decisions, compensation];
    fresh.registerTask(TASK_ID, graph);

    // 在补偿节点上显示两次探针。
    for (let index = 0; index < PROBE_LIMIT_PER_CANONICAL_GOAL; index += 1) {
      const context = fresh.buildStrategyContext({
        sessionId: SESSION_ID,
        taskId: TASK_ID,
        decisions: graph,
        strategy: withProbe(strategyFixture, compensation.goal_key),
      });
      fresh.recordCommittedProbe({ sessionId: SESSION_ID, taskId: TASK_ID, context });
    }

    // 换回父目标：额度应已用尽——这正是"换节点名不能重置预算"。
    const parentContext = fresh.buildStrategyContext({
      sessionId: SESSION_ID,
      taskId: TASK_ID,
      decisions: graph,
      strategy: withProbe(strategyFixture, parent.goal_key),
    });
    expect(parentContext.probeAdmission?.allowed).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// StudentView 白名单投影
// ---------------------------------------------------------------------------

describe('StudentView 白名单投影', () => {
  function source(overrides: Partial<StudentViewSource> = {}): StudentViewSource {
    return {
      sessionId: SESSION_ID,
      version: 3,
      phase: 'study',
      problem,
      activeTaskPromptMd: problem.statement_md,
      messages: [],
      decisions: packet.decisions,
      currentGoalKey: packet.decisions[0]!.goal_key,
      attempt: null,
      notice: '',
      runStatus: 'idle',
      canStartCheck: false,
      ...overrides,
    };
  }

  it('投影结果满足 StudentView 契约', () => {
    const view = projectStudentView(source());
    expect(StudentViewSchema.safeParse(view).success).toBe(true);
  });

  const PRIVATE_MESSAGE: PrivateMessage = {
    id: 'm1',
    role: 'teacher',
    text_md: '只看倒数项，你怎样说明它的求导依据？',
    created_at: '2026-09-18T00:00:00.000Z',
    rationale: '支持概念缺口假设 h1，采用表示转换桥梁',
    decision_ids: ['d1'],
  };

  it('消息投影丢弃教学理由与内部决策引用', () => {
    const projected = projectPublicMessage(PRIVATE_MESSAGE);

    expect(Object.keys(projected).sort()).toEqual(['created_at', 'id', 'role', 'text_md']);
    const serialised = JSON.stringify(projected);
    expect(serialised).not.toContain('rationale');
    expect(serialised).not.toContain('支持概念缺口假设');
    expect(serialised).not.toContain('decision_ids');
  });

  it('从零构造：StudentView 中不出现任何私有字段名', () => {
    const view = projectStudentView(source({ messages: [PRIVATE_MESSAGE] }));
    const serialised = JSON.stringify(view);

    for (const leaked of ['rationale', 'decision_ids', 'reference_md', 'private_reference_md', 'acceptance_rule', 'gradingEvidence']) {
      expect(serialised, `StudentView 泄露了 ${leaked}`).not.toContain(leaked);
    }
  });

  it('题目投影丢弃 content_hash 与 bank_version', () => {
    const projected = projectPublicProblem(problem);
    expect(Object.keys(projected).sort()).toEqual(['asset_ids', 'id', 'is_official', 'issues', 'source', 'statement_md', 'status']);
    expect(JSON.stringify(projected)).not.toContain(problem.content_hash);
  });

  it('决策投影只暴露四项，绝不泄露教学策略字段', () => {
    const goal = projectPublicGoal(packet.decisions[0]!);
    expect(Object.keys(goal).sort()).toEqual(['goal_key', 'label', 'origin', 'status']);

    const serialised = JSON.stringify(goal);
    // 这些字段一旦泄露，学生就拿到完整教师路线与评分口径。
    expect(serialised).not.toContain('acceptance_rule');
    expect(serialised).not.toContain('entry_condition');
    expect(serialised).not.toContain('expected_artifact');
    expect(serialised).not.toContain('common_gaps');
    expect(serialised).not.toContain('prerequisite_ids');
  });

  it('current_goal 为 null 时投影为 null', () => {
    const view = projectStudentView(source({ currentGoalKey: null }));
    expect(view.current_goal).toBeNull();
  });

  it('current_goal_key 找不到对应决策时投影为 null，不猜测', () => {
    const view = projectStudentView(source({ currentGoalKey: '不存在的目标' }));
    expect(view.current_goal).toBeNull();
  });

  it('attempt 投影丢弃评分证据', () => {
    const view = projectStudentView(
      source({
        attempt: {
          id: 'a1',
          taskId: 'check-1',
          planMd: null,
          planLocked: false,
          answerMd: null,
          assistanceRequested: false,
          helpExposed: false,
          finished: false,
          gradingEvidence: '内部评分依据',
        },
      }),
    );
    expect(view.attempt).not.toBeNull();
    expect(JSON.stringify(view)).not.toContain('内部评分依据');
  });

  it('allowed_actions 由 phase 决定，不由模型输出决定', () => {
    expect(allowedActionsFor('study')).toContain('attempt');
    expect(allowedActionsFor('check_answer')).toEqual(['save_draft', 'finish']);
    expect(allowedActionsFor('preparing')).toEqual(['retry_preparation']);
    // 检验阶段不得出现教学动作——否则学生可在锁定计划后仍请求讲解。
    expect(allowedActionsFor('check_plan')).not.toContain('hint');
    expect(allowedActionsFor('check_answer')).not.toContain('explain');
  });

  it('各阶段都返回至少一个动作，前端不会陷入无操作可用', () => {
    for (const phase of ['preparing', 'study', 'check_plan', 'check_answer', 'summary'] as const) {
      expect(allowedActionsFor(phase).length).toBeGreaterThan(0);
    }
  });
});
