// PolicyGate：由代码执行的教学与安全边界。
//
// 规格依据 design-v6.md §5.1：
//   「PolicyGate由代码执行：身份、版本、有效证据、两探针上限、允许披露集合、用户
//     直接讲解请求、时间/token预算、任务曝光、重复提交与状态转换。模型不能自行写
//     数据库或调用网络工具。」
// 以及 B01 PRD F4 边界条件：
//   「PolicyGate 的调用顺序及"未批准就不能写/展示"的硬边界在 B01 必须成立」。
//
// 本模块是纯函数集合：不调模型、不写状态、不做 IO。Guard（模型）只是本闸门的一个
// 输入，GuardResult.accept 不是放行的充分条件。

import type { AssessmentOutput, GuardResult, Packet, Strategy } from '../contracts/domain.schema.js';
import { validatePacket } from '../contracts/semantic.js';

export type PolicyDenialCode =
  | 'DISCLOSURE_NOT_ALLOWED'
  | 'DISCLOSURE_RESERVED_OVERLAP'
  | 'DISCLOSURE_UNKNOWN_DECISION'
  | 'PROBE_GOAL_INVALID'
  | 'PROBE_LIMIT_REACHED'
  | 'PROBE_COUNT_INVALID'
  | 'DIAGNOSIS_EVIDENCE_INVALID'
  | 'STRATEGY_POLICY_INVALID'
  | 'PACKET_CHECK_TASKS_INSUFFICIENT'
  | 'PACKET_HASH_MISMATCH'
  | 'PACKET_NOT_READY'
  | 'PACKET_SEMANTIC_INVALID'
  | 'PACKET_UNVERIFIED'
  | 'MODEL_GRANTED_INDEPENDENCE'
  | 'GUARD_NOT_ACCEPTED';

export type PolicyDecision =
  | {
      readonly approved: true;
      readonly approvedDisclosures: readonly string[];
      /** 实际构成整题策略帮助时置真——不能靠 L0 标签豁免（contracts/README.md §7）。 */
      readonly wholeTaskDisclosed: boolean;
      readonly reason: string;
    }
  | { readonly approved: false; readonly code: PolicyDenialCode; readonly reason: string };

export interface TurnGateInput {
  readonly strategy: Strategy;
  readonly guard: GuardResult;
  readonly knownDecisionIds: ReadonlySet<string>;
  readonly knownGoalKeys: ReadonlySet<string>;
  /** 当前 canonical goal 已真实显示的探针次数（probe_counters.shown_count）。 */
  readonly probesShownForFocusGoal: number;
}

const PROBE_LIMIT_PER_CANONICAL_GOAL = 2;

/**
 * turn 阶段放行判定。
 *
 * 顺序要点：先做披露边界与探针预算的**代码**检查，再接纳 Guard 的意见。这样即使
 * Guard 返回 accept，代码边界仍可独立否决——反过来不成立。
 */
export function gateTurn(input: TurnGateInput): PolicyDecision {
  const { strategy, guard, knownDecisionIds, knownGoalKeys, probesShownForFocusGoal } = input;

  if (!Number.isSafeInteger(probesShownForFocusGoal) || probesShownForFocusGoal < 0) {
    return { approved: false, code: 'PROBE_COUNT_INVALID', reason: '持久探针计数无效' };
  }

  const allowed = new Set(strategy.allowed_disclosures);
  const reserved = new Set(strategy.reserved_decisions);

  const overlap = [...allowed].filter((id) => reserved.has(id));
  if (overlap.length > 0) {
    return {
      approved: false,
      code: 'DISCLOSURE_RESERVED_OVERLAP',
      reason: `允许披露与保留决策相交：${overlap.join(', ')}`,
    };
  }

  const unknown = [...new Set([...allowed, ...reserved])].filter((id) => !knownDecisionIds.has(id));
  if (unknown.length > 0) {
    return {
      approved: false,
      code: 'DISCLOSURE_UNKNOWN_DECISION',
      reason: `引用了不属于当前 task 的决策：${unknown.join(', ')}`,
    };
  }

  const unapprovedActualDisclosures = guard.actual_disclosed_ids.filter((id) => !allowed.has(id));
  if (unapprovedActualDisclosures.length > 0) {
    return {
      approved: false,
      code: 'DISCLOSURE_NOT_ALLOWED',
      reason: `实际披露超出 Strategy 批准范围：${unapprovedActualDisclosures.join(', ')}`,
    };
  }

  if (
    !knownGoalKeys.has(strategy.focus_goal_key)
    || (strategy.probe !== null && strategy.probe.goal_key !== strategy.focus_goal_key)
  ) {
    return {
      approved: false,
      code: 'PROBE_GOAL_INVALID',
      reason: `探针目标不属于当前稳定路线或与焦点不一致：${strategy.focus_goal_key}`,
    };
  }

  // 两探针上限是教学红线（AGENTS.md §6 第 5 条）。已满时不得换 ID 继续追问，
  // 只能转为局部解释、低风险帮助或明确待定——由策略侧改动作，此处直接否决探针。
  if (strategy.probe !== null && probesShownForFocusGoal >= PROBE_LIMIT_PER_CANONICAL_GOAL) {
    return {
      approved: false,
      code: 'PROBE_LIMIT_REACHED',
      reason: `目标 ${strategy.focus_goal_key} 已显示 ${probesShownForFocusGoal} 次探针，达到上限`,
    };
  }

  if (guard.verdict !== 'accept') {
    return { approved: false, code: 'GUARD_NOT_ACCEPTED', reason: `Guard 判定为 ${guard.verdict}` };
  }

  // 用户明确请求完整讲解时允许 L4，但必须记整题曝光，且不得伪装成低支架
  // （contracts/README.md §7）。Guard 无法精确定位时同样按整题处理。
  const wholeTaskDisclosed =
    guard.whole_task_disclosed || strategy.action === 'worked_solution' || strategy.scaffold_level >= 4;

  return {
    approved: true,
    approvedDisclosures: [...new Set(guard.actual_disclosed_ids)],
    wholeTaskDisclosed,
    reason: wholeTaskDisclosed ? '已批准，并记整题策略曝光' : '已批准',
  };
}

export interface PreparationGateContext {
  readonly expectedProblemHash: string;
  readonly guard: GuardResult;
  /**
   * 来自服务端题库/人工复核记录的可信 reference 标识。模型输出不能向这里写值。
   */
  readonly trustedVerificationReferences: ReadonlySet<string>;
}

/** prepare 阶段放行判定：模型声明 ready 不是充分条件。 */
export function gatePreparation(packet: Packet, context: PreparationGateContext): PolicyDecision {
  if (!packet.ready) {
    return { approved: false, code: 'PACKET_NOT_READY', reason: 'Packet.ready 为假，保持原题待核对' };
  }
  if (packet.blocking_issues.length > 0) {
    return {
      approved: false,
      code: 'PACKET_NOT_READY',
      reason: `存在 blocking_issues：${packet.blocking_issues.join('; ')}`,
    };
  }
  if (packet.reference_source.trim().length === 0) {
    return { approved: false, code: 'PACKET_NOT_READY', reason: 'reference_source 为空' };
  }

  const semanticIssues = validatePacket(packet, {
    expectedProblemHash: context.expectedProblemHash,
  });
  const hashIssue = semanticIssues.find((item) => item.code === 'PACKET_HASH_MISMATCH');
  if (hashIssue) {
    return { approved: false, code: 'PACKET_HASH_MISMATCH', reason: hashIssue.message };
  }
  if (semanticIssues.length > 0) {
    return {
      approved: false,
      code: 'PACKET_SEMANTIC_INVALID',
      reason: semanticIssues.map((item) => item.message).join('；'),
    };
  }

  if (packet.check_tasks.length < 2) {
    return {
      approved: false,
      code: 'PACKET_CHECK_TASKS_INSUFFICIENT',
      reason: `只生成了 ${packet.check_tasks.length} 项检验候选，至少需要 2 项`,
    };
  }

  const hasTrustedPass = packet.verification.some((verification) =>
    verification.kind !== 'model_checked'
    && verification.status === 'pass'
    && context.trustedVerificationReferences.has(verification.reference));
  if (!hasTrustedPass) {
    return {
      approved: false,
      code: 'PACKET_UNVERIFIED',
      reason: '缺少服务端可信数学核对记录；模型自检不能认证 Packet',
    };
  }

  if (context.guard.verdict !== 'accept') {
    return {
      approved: false,
      code: 'GUARD_NOT_ACCEPTED',
      reason: `Guard 判定为 ${context.guard.verdict}：${context.guard.issues.join('；')}`,
    };
  }
  return { approved: true, approvedDisclosures: [], wholeTaskDisclosed: false, reason: 'Packet 就绪' };
}

/**
 * grade 阶段放行判定。
 *
 * AssessmentAgent 只输出 planning / execution 的判定与依据，**独立资格不由它评**
 * （contracts/README.md §8）。模型若在输出里夹带独立结论字段，结构校验本已拒绝
 * （AssessmentOutput 为 strictObject）；此处防御的是被换用宽松 schema 的情况，
 * 确保"模型不得授予独立资格"在代码层也成立。
 */
export function gateGrading(output: AssessmentOutput): PolicyDecision {
  const forbidden = ['independent_pass', 'independent_planning', 'independent_execution', 'help_exposed'];
  const present = forbidden.filter((field) => Object.prototype.hasOwnProperty.call(output, field));
  if (present.length > 0) {
    return {
      approved: false,
      code: 'MODEL_GRANTED_INDEPENDENCE',
      reason: `评分输出不得包含独立资格字段：${present.join(', ')}`,
    };
  }
  return { approved: true, approvedDisclosures: [], wholeTaskDisclosed: false, reason: '评分候选已接受，独立性由代码计算' };
}
