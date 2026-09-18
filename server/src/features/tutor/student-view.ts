// StudentView 白名单投影。
//
// 规格依据 contracts/README.md §2：
//   「SessionState/Packet/Diagnosis/Strategy/TraceStep/CheckTask 是服务端私有对象，绝不
//     作为React组件props、静态资源、SSE原始载荷或API通用返回。StudentView、Report是
//     白名单投影，**从零构造**；禁止使用展开运算符复制私有对象后删除几个字段。」
//
// 因此本文件的每个投影函数都是**逐字段显式构造**，不使用 `...spread`。
// 这不是风格偏好：展开后删字段的写法会在私有对象新增字段时静默泄露，
// 而从零构造会编译失败（对象字面量缺字段），把泄露变成必须处理的事件。
//
// 尤其注意 Decision → PublicGoal 的投影：Decision 携带 acceptance_rule、
// entry_condition、expected_artifact、common_gaps、prerequisite_ids —— 这些是
// 教学策略本身，泄露等于把完整路线交给学生，直接违反「不默认展示完整教师路线」。

import type {
  Decision,
  Problem,
  PublicAttempt,
  PublicGoal,
  PublicMessage,
  PublicProblem,
  StudentView,
} from '../../contracts/domain.schema.js';

/** 服务端私有的消息记录。只有 id/role/text_md/created_at 是对外可见的。 */
export interface PrivateMessage {
  readonly id: string;
  readonly role: 'student' | 'teacher' | 'system';
  readonly text_md: string;
  readonly created_at: string;
  /** 服务端私有的教学理由，绝不出现在 StudentView。 */
  readonly rationale?: string;
  /** 命中的决策 id，属内部记账，不对外。 */
  readonly decision_ids?: readonly string[];
}

/** 服务端私有的检验尝试记录。 */
export interface PrivateAttempt {
  readonly id: string;
  readonly taskId: string;
  readonly planMd: string | null;
  readonly planLocked: boolean;
  readonly answerMd: string | null;
  readonly assistanceRequested: boolean;
  readonly helpExposed: boolean;
  readonly finished: boolean;
  /** 评分证据与 rubric，属私有，不对外。 */
  readonly gradingEvidence?: string;
}

/** 构造 StudentView 所需的服务端事实。 */
export interface StudentViewSource {
  readonly sessionId: string;
  readonly version: number;
  readonly phase: StudentView['phase'];
  readonly problem: Problem;
  readonly activeTaskPromptMd: string;
  readonly messages: readonly PrivateMessage[];
  readonly decisions: readonly Decision[];
  readonly currentGoalKey: string | null;
  readonly attempt: PrivateAttempt | null;
  readonly notice: string;
  readonly runStatus: StudentView['run_status'];
  readonly canStartCheck: boolean;
}

/**
 * Problem → PublicProblem。丢弃 content_hash、bank_version 与内部主题标签。
 * 逐字段构造，不使用展开。
 */
export function projectPublicProblem(problem: Problem): PublicProblem {
  return {
    id: problem.id,
    source: problem.source,
    is_official: problem.is_official,
    statement_md: problem.statement_md,
    asset_ids: [...problem.asset_ids],
    status: problem.status,
    issues: [...problem.issues],
  };
}

/**
 * PrivateMessage → PublicMessage。只保留四个对外字段。
 *
 * `rationale` 与 `decision_ids` 被有意丢弃——它们解释"为什么这样问"，
 * 属于教师依据（B06 的教师页才可经鉴权与曝光记账后查看），学生端不应出现。
 */
export function projectPublicMessage(message: PrivateMessage): PublicMessage {
  return {
    id: message.id,
    role: message.role,
    text_md: message.text_md,
    created_at: message.created_at,
  };
}

/**
 * Decision → PublicGoal。**这是最危险的一条投影。**
 *
 * Decision 携带 entry_condition / expected_artifact / acceptance_rule / common_gaps /
 * prerequisite_ids —— 它们共同描述了教学策略与评分口径。若泄露，学生就拿到了
 * 完整教师路线，"独立规划"随即失去意义。
 * PublicGoal 因此只取 goal_key / label / origin / status 四项。
 */
export function projectPublicGoal(decision: Decision): PublicGoal {
  return {
    goal_key: decision.goal_key,
    label: decision.goal,
    origin: decision.source,
    // status 由代码按当前决策证据派生；此处保守标为进行中，不据模型自评提升。
    status: 'in_progress',
  };
}

/** PrivateAttempt → PublicAttempt。丢弃评分证据。 */
export function projectPublicAttempt(attempt: PrivateAttempt): PublicAttempt {
  return {
    id: attempt.id,
    task_id: attempt.taskId,
    plan_md: attempt.planMd,
    plan_locked: attempt.planLocked,
    answer_md: attempt.answerMd,
    assistance_requested: attempt.assistanceRequested,
    help_exposed: attempt.helpExposed,
    finished: attempt.finished,
  };
}

/**
 * 从零构造 StudentView。
 *
 * 注意 messages 的数量：规格允许最多 500 条。超出时**整段拒绝**而非截断——
 * 静默截断会让前端以为历史完整，而截掉的可能是关键证据。
 */
export function projectStudentView(source: StudentViewSource): StudentView {
  const currentDecision =
    source.currentGoalKey === null
      ? null
      : (source.decisions.find((decision) => decision.goal_key === source.currentGoalKey) ?? null);

  return {
    session_id: source.sessionId,
    version: source.version,
    phase: source.phase,
    problem: projectPublicProblem(source.problem),
    active_task_prompt_md: source.activeTaskPromptMd,
    messages: source.messages.map(projectPublicMessage),
    current_goal: currentDecision === null ? null : projectPublicGoal(currentDecision),
    attempt: source.attempt === null ? null : projectPublicAttempt(source.attempt),
    notice: source.notice,
    allowed_actions: [...allowedActionsFor(source.phase)],
    run_status: source.runStatus,
    can_start_check: source.canStartCheck,
  };
}

/**
 * 各阶段允许的动作。
 *
 * 由代码按 phase 决定，不由模型输出决定——学生可见动作是权限边界的一部分，
 * 不能让模型通过返回一个 allowed_actions 数组来扩大它。
 */
export function allowedActionsFor(phase: StudentView['phase']): readonly string[] {
  switch (phase) {
    case 'preparing':
      return ['retry_preparation'];
    case 'study':
      return ['attempt', 'hint', 'explain', 'worked_solution', 'propose_route', 'skip_goal', 'finish_problem'];
    case 'check_plan':
      return ['save_draft', 'submit_plan'];
    case 'check_answer':
      return ['save_draft', 'finish'];
    case 'summary':
      return ['start_check'];
  }
}
