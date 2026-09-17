// 角色上下文投影。
//
// 规格依据 AGENTS.md §7：
//   「产品保持 Preparation / Diagnosis / Strategy / Assessment 四个独立角色的上下文、
//     Schema、提示版本和回归；Renderer/Guard 依职责工作。不能只在同一自由聊天提示里
//     写四个名字冒充独立 Agent。」
// 以及 B01 PRD F2 的边界表：「不能共用一个全量上下文」。
//
// 本模块是 agents.json 的 forbidden 列表唯一的落地点——权限边界不由提示词承载，
// 而由"构造该角色输入时根本没有该项字段可传"来保证。因此每个投影函数只接受
// SessionContext，只读出被允许的字段。
//
// SessionContext 是服务端私有的会话聚合，绝不投影给学生、浏览器或 SSE 载荷
// （contracts/README.md §2 信任边界）。

import type {
  ApprovedFact,
  CheckTask,
  Decision,
  Diagnosis,
  EvidenceRef,
  Exposure,
  Hypothesis,
  Problem,
  ProbeProposal,
  Route,
  RoutePatch,
  Strategy,
  Submission,
} from '../contracts/domain.schema.js';
import type {
  AssessmentInput,
  DiagnosisInput,
  GuardInput,
  PreparationInput,
  RendererInput,
  StrategyInput,
} from '../contracts/domain.schema.js';

export interface SessionContext {
  readonly taskId: string;

  // --- Preparation 可见：题干、授权参考、题库读取 ---
  readonly problem: Problem;
  readonly referenceMaterialMd: string;
  readonly studentRouteMd: string | null;

  // --- Diagnosis 可见：仅已确认的有效证据 ---
  readonly submissions: readonly Submission[];
  readonly previousHypotheses: readonly Hypothesis[];
  readonly previousProbes: readonly ProbeProposal[];

  // --- 路线图（Preparation 产出，Diagnosis/Strategy 消费） ---
  readonly decisions: readonly Decision[];
  readonly routes: readonly Route[];

  // --- 私有参考：仅 Preparation / Diagnosis / Strategy 可见 ---
  readonly privateReferenceMd: string;

  // --- Strategy 可见：诊断、求助意图、曝光账、剩余预算 ---
  readonly diagnosis: Diagnosis;
  readonly userAction: string;
  readonly exposures: readonly Exposure[];
  readonly remainingProbes: number;
  readonly remainingCalls: number;
  readonly routePatch: RoutePatch | null;

  // --- Renderer 可见：公开投影与已批准事实，无私有参考 ---
  readonly publicPromptMd: string;
  readonly publicHistoryMd: readonly string[];
  readonly strategy: Strategy;

  // --- Assessment 可见：锁定计划与最终答案，无历史诊断 ---
  readonly checkTask: CheckTask;
  readonly lockedPlanMd: string;
  readonly finalAnswerMd: string;

  // --- Guard 可见：候选产物与披露边界 ---
  readonly guardReferenceMd: string;
}

/** 诊断证据只取当前有效且已确认的提交（contracts/README.md §7）。 */
export function confirmedSubmissions(submissions: readonly Submission[]): readonly Submission[] {
  return submissions.filter((submission) => submission.confirmed && !submission.invalidated);
}

/**
 * Preparation：输入只有题干、授权参考与学生路线。
 * 不含 owner 身份、不含会话状态——Preparation 无法写出会话，因为输入里没有它。
 */
export function projectPreparationInput(
  context: SessionContext,
  mode: PreparationInput['mode'],
  evidenceRefs: readonly EvidenceRef[] = [],
): PreparationInput {
  return {
    mode,
    problem: context.problem,
    reference_material_md: context.referenceMaterialMd,
    student_route_md: context.studentRouteMd,
    evidence_refs: [...evidenceRefs],
  };
}

/**
 * Diagnosis：证据只取已确认且未失效的提交。
 * 未确认的手写转写与非法的未来检验内容不会进入——不是靠过滤掉，而是这里根本不读。
 */
export function projectDiagnosisInput(context: SessionContext): DiagnosisInput {
  return {
    task_id: context.taskId,
    prompt_md: context.problem.statement_md,
    decisions: [...context.decisions],
    routes: [...context.routes],
    confirmed_evidence: [...confirmedSubmissions(context.submissions)],
    previous_hypotheses: [...context.previousHypotheses],
    previous_probes: [...context.previousProbes],
    private_reference_md: context.privateReferenceMd,
  };
}

/** Strategy：诊断 + 求助意图 + 曝光账 + 剩余预算。不改变预算，只被告知剩余量。 */
export function projectStrategyInput(context: SessionContext): StrategyInput {
  return {
    diagnosis: context.diagnosis,
    user_action: context.userAction,
    exposures: [...context.exposures],
    remaining_probes: context.remainingProbes,
    remaining_calls: context.remainingCalls,
    route_patch: context.routePatch,
    decisions: [...context.decisions],
    private_reference_md: context.privateReferenceMd,
  };
}

/**
 * Assessment：**只有**锁定计划、最终答案与检验题本身。
 *
 * 规格要求「上下文不含历史误诊、学习画像或 teacher 标签，减少先入偏见」
 * （contracts/README.md §8）。此处不读取 context.diagnosis / submissions /
 * previousHypotheses——先入信息无法进入，而非"传了但不看"。
 */
export function projectAssessmentInput(context: SessionContext): AssessmentInput {
  return {
    task: context.checkTask,
    locked_plan_md: context.lockedPlanMd,
    final_answer_md: context.finalAnswerMd,
  };
}

/** Renderer：最小信息，不含完整私有参考、未来 rubric 或原始诊断。 */
export function projectRendererInput(context: SessionContext, approvedFacts: readonly ApprovedFact[]): RendererInput {
  return {
    task_id: context.taskId,
    public_prompt_md: context.publicPromptMd,
    public_history_md: [...context.publicHistoryMd],
    action: context.strategy.action,
    intervention: context.strategy.intervention,
    scaffold_level: context.strategy.scaffold_level,
    approved_facts: [...approvedFacts],
    question_md: context.strategy.probe?.question_md ?? null,
    expected_student_artifact: context.strategy.expected_student_artifact,
  };
}

/**
 * Guard：候选产物（序列化字符串）与披露边界。
 *
 * candidate_json 在 GuardInput 中是字符串而非嵌套对象（见 domain.schema.json），
 * 该设计使"模型看到的是待检验的文本"而非"已经解析过的结构"，避免解析成功被误当作校验通过。
 */
export function projectGuardInput(
  context: SessionContext,
  mode: GuardInput['mode'],
  candidate: unknown,
  allowedDisclosures: readonly string[],
  reservedDecisions: readonly string[],
): GuardInput {
  return {
    mode,
    task_id: context.taskId,
    candidate_json: JSON.stringify(candidate ?? null),
    reference_md: context.guardReferenceMd,
    allowed_disclosures: [...allowedDisclosures],
    reserved_decisions: [...reservedDecisions],
  };
}
