// turn 工作流：教学轮的领域规则。
//
// 职责边界（与 server/src/workflows/prepare.ts 同构）：
//   * 本文件负责教学轮中**由代码决定**的部分——规范目标推导、探针准入与记账、
//     曝光构造、StudentView 源组装。
//   * 模型调用、run/lease/预算与最终提交由 WorkflowOrchestrator 负责。
//
// 之所以把"提不提探针"放在代码里：Diagnosis.probe 与 Strategy.focus_goal_key 都是
// 模型输出。若由模型自决，它只要每次换一个 goal_key 就能无限追问。规格因此规定
// 「模型不可自己新建key逃避计数」（contracts/README.md §7），计数键必须由已批准的
// 决策图推导。本文件是这条规定的执行点。

import type { Decision, Problem, Strategy } from '../contracts/domain.schema.js';
import { gateTurn, type PolicyDecision } from './policy-gate.js';
import {
  CanonicalGoalRegistry,
  PROBE_LIMIT_PER_CANONICAL_GOAL,
  ProbeCounter,
  type ProbeAdmission,
} from '../features/tutor/probe-counter.js';
import type { PrivateAttempt, PrivateMessage, StudentViewSource } from '../features/tutor/student-view.js';
import type { GuardResult } from '../contracts/domain.schema.js';

/** 一次教学轮的策略上下文：规范化后的目标键与剩余探针数。 */
export interface TurnStrategyContext {
  /** 规范化后的当前目标键，取代模型给的 focus_goal_key 用于记账。 */
  readonly canonicalGoalKey: string | null;
  /**
   * 已登记决策的 goal_key 全集。gateTurn 用它拒绝模型凭空造出的 focus_goal_key
   * ——与 canonical key 是两道互补的检查：这里管"目标存不存在"，
   * canonicalGoalKey 管"额度记在谁头上"。
   */
  readonly knownGoalKeys: ReadonlySet<string>;
  /** 该目标**已真实显示**的探针次数。 */
  readonly shownCount: number;
  /** 该目标还剩几次可显示的探针。 */
  readonly remainingProbes: number;
  /** 若模型提了探针，其准入判定；未提探针时为 null。 */
  readonly probeAdmission: ProbeAdmission | null;
}

export interface TurnWorkflowDeps {
  readonly registry?: CanonicalGoalRegistry;
  readonly probes?: ProbeCounter;
}

export class TurnWorkflow {
  readonly #registry: CanonicalGoalRegistry;
  readonly #probes: ProbeCounter;

  constructor(deps: TurnWorkflowDeps = {}) {
    this.#registry = deps.registry ?? new CanonicalGoalRegistry();
    this.#probes = deps.probes ?? new ProbeCounter();
  }

  get registry(): CanonicalGoalRegistry {
    return this.#registry;
  }

  get probes(): ProbeCounter {
    return this.#probes;
  }

  /** 登记已批准的决策图。应在 prepare 完成后、进入教学轮前调用。 */
  registerTask(taskId: string, decisions: readonly Decision[]): void {
    this.#registry.register(taskId, decisions);
  }

  /**
   * 由模型输出推导本轮策略上下文。
   *
   * 注意 `focus_goal_key` 若无法映射到已登记的决策，则规范键为 null 且不允许提探针——
   * 宁可记为"无目标"也不能让一个凭空出现的 key 获得探针额度。
   */
  buildStrategyContext(params: {
    readonly sessionId: string;
    readonly taskId: string;
    readonly decisions: readonly Decision[];
    readonly strategy: Pick<Strategy, 'focus_goal_key' | 'probe'>;
  }): TurnStrategyContext {
    const { sessionId, taskId, decisions, strategy } = params;
    const knownGoalKeys = new Set(decisions.map((item) => item.goal_key));
    const decision =
      decisions.find((item) => item.goal_key === strategy.focus_goal_key) ??
      decisions.find((item) => item.id === strategy.focus_goal_key) ??
      null;

    const canonicalGoalKey = decision === null ? null : this.#registry.resolve(taskId, decision);

    if (canonicalGoalKey === null) {
      // 模型给的 focus_goal_key 无法映射到已登记决策：不授予任何探针额度。
      // 宁可记为"无目标"，也不让凭空出现的 key 换来追问机会。
      return { canonicalGoalKey: null, knownGoalKeys, shownCount: 0, remainingProbes: 0, probeAdmission: null };
    }

    const shownCount = this.#probes.shownCount(sessionId, taskId, canonicalGoalKey);
    const remainingProbes = PROBE_LIMIT_PER_CANONICAL_GOAL - shownCount;
    const probeAdmission = strategy.probe === null ? null : this.#probes.admit(sessionId, taskId, canonicalGoalKey);

    return { canonicalGoalKey, knownGoalKeys, shownCount, remainingProbes, probeAdmission };
  }

  /**
   * 教学轮放行判定。
   *
   * 把探针准入并入 PolicyGate：即使 Guard 接受、披露边界也合规，只要该目标的
   * 探针额度用尽，代码仍会否决这一轮的探针。
   */
  gate(params: {
    readonly strategy: Strategy;
    readonly guard: GuardResult;
    readonly knownDecisionIds: ReadonlySet<string>;
    readonly context: TurnStrategyContext;
  }): PolicyDecision {
    // 探针额度用尽时把策略里的 probe 摘掉再交给 PolicyGate。规格要求
    // 「已两次探针时…改用局部解释/低风险帮助/明确待定」，而不是整轮失败——
    // 学生仍应得到帮助，只是不再通过追问来诊断。
    const probeExhausted = params.context.probeAdmission !== null && !params.context.probeAdmission.allowed;
    const effectiveStrategy: Strategy = probeExhausted ? { ...params.strategy, probe: null } : params.strategy;

    const decision = gateTurn({
      strategy: effectiveStrategy,
      guard: params.guard,
      knownDecisionIds: params.knownDecisionIds,
      knownGoalKeys: params.context.knownGoalKeys,
      // 传真实已显示次数而非 0：探针已被摘掉时 gateTurn 的探针分支本就不会触发，
      // 而未摘掉时这个值必须真实，否则等于谎报额度用量。
      probesShownForFocusGoal: params.context.shownCount,
    });

    if (probeExhausted && decision.approved) {
      return {
        ...decision,
        reason: `${decision.reason}；探针额度已用尽，本轮转为局部解释或待定`,
      };
    }
    return decision;
  }

  /**
   * checked commit 之后记账一次真实显示的探针。
   *
   * 必须在提交成功之后调用：未提交的候选不算"已显示"，
   * 否则一次 Guard 拒绝就会白白吃掉学生的探针额度。
   */
  recordCommittedProbe(params: {
    readonly sessionId: string;
    readonly taskId: string;
    readonly context: TurnStrategyContext;
  }): number | null {
    const { sessionId, taskId, context } = params;
    if (context.canonicalGoalKey === null || context.probeAdmission === null || !context.probeAdmission.allowed) {
      return null;
    }
    return this.#probes.recordShown(sessionId, taskId, context.canonicalGoalKey);
  }

  /** 组装 StudentView 源。投影本身是纯函数，见 features/tutor/student-view.ts。 */
  buildStudentViewSource(params: {
    readonly sessionId: string;
    readonly version: number;
    readonly phase: StudentViewSource['phase'];
    readonly problem: Problem;
    readonly activeTaskPromptMd: string;
    readonly messages: readonly PrivateMessage[];
    readonly decisions: readonly Decision[];
    readonly currentGoalKey: string | null;
    readonly attempt: PrivateAttempt | null;
    readonly notice: string;
    readonly runStatus: StudentViewSource['runStatus'];
    readonly canStartCheck: boolean;
  }): StudentViewSource {
    return { ...params };
  }
}
