// 本文件由 server/src/contracts/generate-zod.mjs 自动生成，请勿手工编辑。
// 来源：qisi-sdd-v3/contracts/domain.schema.json（48 个 $defs，只读规格包）。
// 重新生成：node server/src/contracts/generate-zod.mjs
//
// 结构约束来自该 JSON Schema；引用、数学、授权、曝光与幂等规则不在 Schema 内，
// 见 qisi-sdd-v3/contracts/README.md，由 server/src/contracts/semantic.ts 实现。
//
// 规格包中唯一的重命名：$defs 的 `Error` 导出为 `DomainError`，避免遮蔽 TypeScript 内建 Error。

import { z } from 'zod';
// EvidenceRef
export const EvidenceRefSchema = z.strictObject({
  submission_id: z.string().min(1).max(128),
  revision: z.int().min(1),
  quote: z.string().max(12000),
});
export type EvidenceRef = z.infer<typeof EvidenceRefSchema>;

// Verification
export const VerificationSchema = z.strictObject({
  kind: z.enum(["model_checked", "human_reviewed", "source_reference", "deterministic_check"]),
  reviewer_or_model: z.string().max(12000),
  reference: z.string().max(12000),
  summary: z.string().max(12000),
  status: z.enum(["pass", "fail", "unknown"]),
  checked_at: z.iso.datetime(),
});
export type Verification = z.infer<typeof VerificationSchema>;

// Problem
export const ProblemSchema = z.strictObject({
  id: z.string().min(1).max(128),
  bank_version: z.string().min(1).max(128),
  source: z.string().max(12000),
  is_official: z.boolean(),
  statement_md: z.string().max(12000),
  asset_ids: z.array(z.string().min(1).max(128)).min(0).max(100),
  content_hash: z.string().regex(new RegExp("^[0-9a-f]{64}$")),
  status: z.enum(["ready", "needs_review", "invalid"]),
  issues: z.array(z.string().max(12000)).min(0).max(30),
  topic_tags: z.array(z.string().max(12000)).min(0).max(30),
});
export type Problem = z.infer<typeof ProblemSchema>;

// Decision
export const DecisionSchema = z.strictObject({
  id: z.string().min(1).max(128),
  goal_key: z.string().min(1).max(128),
  goal: z.string().max(12000),
  part_id: z.string().min(1).max(128),
  parent_goal_key: z.string().min(1).max(128).nullable(),
  source: z.enum(["student", "teacher", "coauthored"]),
  prerequisite_ids: z.array(z.string().min(1).max(128)).min(0).max(100),
  entry_condition: z.string().max(12000),
  expected_artifact: z.string().max(12000),
  acceptance_rule: z.string().max(12000),
  common_gaps: z.array(z.string().max(12000)).min(0).max(30),
});
export type Decision = z.infer<typeof DecisionSchema>;

// Route
export const RouteSchema = z.strictObject({
  id: z.string().min(1).max(128),
  source: z.enum(["student", "teacher", "coauthored"]),
  decision_ids: z.array(z.string().min(1).max(128)).min(0).max(100),
  terminal_ids: z.array(z.string().min(1).max(128)).min(0).max(100),
  math_status: z.enum(["valid", "invalid", "unknown"]),
  evidence_refs: z.array(EvidenceRefSchema).min(0).max(100),
  note: z.string().max(12000),
});
export type Route = z.infer<typeof RouteSchema>;

// CheckTask
export const CheckTaskSchema = z.strictObject({
  id: z.string().min(1).max(128),
  source_problem_id: z.string().min(1).max(128),
  content_hash: z.string().regex(new RegExp("^[0-9a-f]{64}$")),
  equivalence_group: z.string().min(1).max(128),
  relation: z.enum(["near_transfer", "near_duplicate"]),
  prompt_md: z.string().max(12000),
  reference_md: z.string().max(12000),
  planning_rubric: z.string().max(12000),
  execution_rubric: z.string().max(12000),
  decisions: z.array(DecisionSchema).min(1).max(24),
  routes: z.array(RouteSchema).min(1).max(8),
  verification: z.array(VerificationSchema).min(1).max(20),
  verified: z.boolean(),
});
export type CheckTask = z.infer<typeof CheckTaskSchema>;

// Packet
export const PacketSchema = z.strictObject({
  problem_id: z.string().min(1).max(128),
  problem_hash: z.string().regex(new RegExp("^[0-9a-f]{64}$")),
  version: z.string().min(1).max(128),
  reference_md: z.string().max(12000),
  reference_source: z.string().max(12000),
  decisions: z.array(DecisionSchema).min(1).max(24),
  routes: z.array(RouteSchema).min(1).max(8),
  verification: z.array(VerificationSchema).min(1).max(20),
  blocking_issues: z.array(z.string().max(12000)).min(0).max(30),
  ready: z.boolean(),
  check_tasks: z.array(CheckTaskSchema).min(0).max(12),
  coverage_note: z.string().max(12000),
});
export type Packet = z.infer<typeof PacketSchema>;

// RoutePatch
export const RoutePatchSchema = z.strictObject({
  task_id: z.string().min(1).max(128),
  new_decisions: z.array(DecisionSchema).min(0).max(6),
  new_routes: z.array(RouteSchema).min(0).max(2),
  evidence_refs: z.array(EvidenceRefSchema).min(0).max(100),
  math_status: z.enum(["valid", "invalid", "unknown"]),
  verification: z.array(VerificationSchema).min(1).max(10),
  blocking_issues: z.array(z.string().max(12000)).min(0).max(30),
});
export type RoutePatch = z.infer<typeof RoutePatchSchema>;

// TranscriptLine
export const TranscriptLineSchema = z.strictObject({
  index: z.int().min(1),
  text: z.string().max(12000),
  uncertain: z.boolean(),
  explicitly_confirmed: z.boolean(),
});
export type TranscriptLine = z.infer<typeof TranscriptLineSchema>;

// TranscriptDraft
export const TranscriptDraftSchema = z.strictObject({
  id: z.string().min(1).max(128),
  media_id: z.string().min(1).max(128),
  revision: z.int().min(1),
  lines: z.array(TranscriptLineSchema).min(1).max(200),
  confirmed: z.boolean(),
});
export type TranscriptDraft = z.infer<typeof TranscriptDraftSchema>;

// Submission
export const SubmissionSchema = z.strictObject({
  id: z.string().min(1).max(128),
  task_id: z.string().min(1).max(128),
  revision: z.int().min(1),
  text_md: z.string().max(12000),
  source: z.enum(["typed", "handwriting"]),
  media_id: z.string().min(1).max(128).nullable(),
  transcript_id: z.string().min(1).max(128).nullable(),
  confirmed: z.boolean(),
  invalidated: z.boolean(),
  created_at: z.iso.datetime(),
});
export type Submission = z.infer<typeof SubmissionSchema>;

// Hypothesis
export const HypothesisSchema = z.strictObject({
  id: z.string().min(1).max(128),
  kind: z.enum(["concept", "execution", "strategy", "comprehension", "condition", "representation", "undetermined"]),
  status: z.enum(["candidate", "supported", "refuted", "undetermined"]),
  evidence_refs: z.array(EvidenceRefSchema).min(0).max(100),
  explanation: z.string().max(12000),
  missing_evidence: z.string().max(12000),
});
export type Hypothesis = z.infer<typeof HypothesisSchema>;

// ProbeBranch
export const ProbeBranchSchema = z.strictObject({
  hypothesis_id: z.string().min(1).max(128),
  expected: z.string().max(12000),
  counter_evidence: z.string().max(12000),
  next_action: z.string().max(12000),
});
export type ProbeBranch = z.infer<typeof ProbeBranchSchema>;

// ProbeProposal
export const ProbeProposalSchema = z.strictObject({
  goal_key: z.string().min(1).max(128),
  question_md: z.string().max(12000),
  branches: z.array(ProbeBranchSchema).min(2).max(3),
});
export type ProbeProposal = z.infer<typeof ProbeProposalSchema>;

// Diagnosis
export const DiagnosisSchema = z.strictObject({
  task_id: z.string().min(1).max(128),
  judgment: z.enum(["valid", "invalid", "unknown"]),
  evidence_refs: z.array(EvidenceRefSchema).min(0).max(100),
  summary: z.string().max(12000),
  focus_goal_key: z.string().min(1).max(128),
  hypotheses: z.array(HypothesisSchema).min(1).max(3),
  probe: ProbeProposalSchema.nullable(),
  satisfied_decision_ids: z.array(z.string().min(1).max(128)).min(0).max(100),
  route_review_needed: z.boolean(),
  route_review_reason: z.string().max(12000),
});
export type Diagnosis = z.infer<typeof DiagnosisSchema>;

// ApprovedFact
export const ApprovedFactSchema = z.strictObject({
  text_md: z.string().max(12000),
  decision_ids: z.array(z.string().min(1).max(128)).min(0).max(100),
  source_ref: z.string().max(12000),
});
export type ApprovedFact = z.infer<typeof ApprovedFactSchema>;

// Strategy
export const StrategySchema = z.strictObject({
  task_id: z.string().min(1).max(128),
  action: z.enum(["ask", "hint", "explain", "worked_solution", "advance", "complete", "uncertain"]),
  intervention: z.enum(["condition_check", "goal_backchain", "representation_bridge", "prior_result_bridge", "counterexample", "error_localization", "worked_fade", "observe"]),
  scaffold_level: z.int().min(0).max(4),
  focus_goal_key: z.string().min(1).max(128),
  probe: ProbeProposalSchema.nullable(),
  allowed_facts: z.array(ApprovedFactSchema).min(0).max(20),
  allowed_disclosures: z.array(z.string().min(1).max(128)).min(0).max(100),
  reserved_decisions: z.array(z.string().min(1).max(128)).min(0).max(100),
  expected_student_artifact: z.string().max(12000),
  decision_reason: z.string().max(12000),
  fading_reason: z.string().max(12000),
  route_patch: RoutePatchSchema.nullable(),
});
export type Strategy = z.infer<typeof StrategySchema>;

// RendererInput
export const RendererInputSchema = z.strictObject({
  task_id: z.string().min(1).max(128),
  public_prompt_md: z.string().max(12000),
  public_history_md: z.array(z.string().max(12000)).min(0).max(30),
  action: z.string().max(12000),
  intervention: z.string().max(12000),
  scaffold_level: z.int().min(0),
  approved_facts: z.array(ApprovedFactSchema).min(0).max(100),
  question_md: z.string().max(12000).nullable(),
  expected_student_artifact: z.string().max(12000),
});
export type RendererInput = z.infer<typeof RendererInputSchema>;

// RenderedMessage
export const RenderedMessageSchema = z.strictObject({
  text_md: z.string().max(12000),
});
export type RenderedMessage = z.infer<typeof RenderedMessageSchema>;

// GuardResult
export const GuardResultSchema = z.strictObject({
  verdict: z.enum(["accept", "revise", "unknown"]),
  math_note: z.string().max(12000),
  disclosure_note: z.string().max(12000),
  actual_disclosed_ids: z.array(z.string().min(1).max(128)).min(0).max(100),
  whole_task_disclosed: z.boolean(),
  issues: z.array(z.string().max(12000)).min(0).max(30),
});
export type GuardResult = z.infer<typeof GuardResultSchema>;

// AssessmentOutput
export const AssessmentOutputSchema = z.strictObject({
  task_id: z.string().min(1).max(128),
  planning: z.enum(["correct", "incorrect", "unknown", "unanswered"]),
  execution: z.enum(["correct", "incorrect", "unknown", "unanswered"]),
  planning_reason: z.string().max(12000),
  execution_reason: z.string().max(12000),
  planning_evidence: z.string().max(12000),
  execution_evidence: z.string().max(12000),
  unresolved_issues: z.array(z.string().max(12000)).min(0).max(30),
});
export type AssessmentOutput = z.infer<typeof AssessmentOutputSchema>;

// Exposure
export const ExposureSchema = z.strictObject({
  id: z.string().min(1).max(128),
  task_id: z.string().min(1).max(128),
  content_hash: z.string().regex(new RegExp("^[0-9a-f]{64}$")),
  turn_id: z.string().min(1).max(128),
  decision_ids: z.array(z.string().min(1).max(128)).min(0).max(100),
  scope: z.enum(["listed_decisions", "whole_task"]),
  reason: z.enum(["teacher_hint", "teacher_trace", "route_reveal", "worked_solution", "assessment_feedback"]),
  created_at: z.iso.datetime(),
});
export type Exposure = z.infer<typeof ExposureSchema>;

// DecisionEvidence
export const DecisionEvidenceSchema = z.strictObject({
  decision_id: z.string().min(1).max(128),
  goal_key: z.string().min(1).max(128),
  status: z.enum(["unobserved", "valid", "invalid", "unknown", "invalidated"]),
  origin: z.enum(["student", "teacher", "coauthored"]),
  evidence_refs: z.array(EvidenceRefSchema).min(0).max(100),
  help_exposed: z.boolean(),
});
export type DecisionEvidence = z.infer<typeof DecisionEvidenceSchema>;

// CheckAttempt
export const CheckAttemptSchema = z.strictObject({
  id: z.string().min(1).max(128),
  task_id: z.string().min(1).max(128),
  content_hash: z.string().regex(new RegExp("^[0-9a-f]{64}$")),
  equivalence_group: z.string().min(1).max(128),
  relation: z.enum(["near_transfer", "near_duplicate"]),
  started_at: z.iso.datetime(),
  plan_md: z.string().max(12000).nullable(),
  plan_locked_at: z.iso.datetime().nullable(),
  answer_md: z.string().max(12000).nullable(),
  finished_at: z.iso.datetime().nullable(),
  assistance_requested: z.boolean(),
  help_exposed: z.boolean(),
  invalidated: z.boolean(),
  first_seen_eligible: z.boolean(),
  assessment: AssessmentOutputSchema.nullable(),
});
export type CheckAttempt = z.infer<typeof CheckAttemptSchema>;

// TraceStep
export const TraceStepSchema = z.strictObject({
  turn_id: z.string().min(1).max(128),
  task_id: z.string().min(1).max(128),
  submission_id: z.string().min(1).max(128).nullable(),
  diagnosis: DiagnosisSchema.nullable(),
  strategy: StrategySchema.nullable(),
  guard: GuardResultSchema.nullable(),
  shown_text_md: z.string().max(12000),
  probe_ordinal: z.int().min(0),
  created_at: z.iso.datetime(),
  invalidated: z.boolean(),
  run_id: z.string().min(1).max(128),
});
export type TraceStep = z.infer<typeof TraceStepSchema>;

// SessionState
export const SessionStateSchema = z.strictObject({
  id: z.string().min(1).max(128),
  version: z.int().min(1),
  problem_id: z.string().min(1).max(128),
  packet_version: z.string().min(1).max(128).nullable(),
  phase: z.enum(["preparing", "study", "check_plan", "check_answer", "summary"]),
  active_task_id: z.string().min(1).max(128),
  active_attempt_id: z.string().min(1).max(128).nullable(),
  submissions: z.array(SubmissionSchema).min(0).max(500),
  traces: z.array(TraceStepSchema).min(0).max(500),
  exposures: z.array(ExposureSchema).min(0).max(500),
  decision_evidence: z.array(DecisionEvidenceSchema).min(0).max(200),
  attempts: z.array(CheckAttemptSchema).min(0).max(30),
  original_result: z.enum(["in_progress", "correct", "incomplete", "unknown"]),
  current_route_id: z.string().min(1).max(128).nullable(),
});
export type SessionState = z.infer<typeof SessionStateSchema>;

// PublicProblem
export const PublicProblemSchema = z.strictObject({
  id: z.string().min(1).max(128),
  source: z.string().max(12000),
  is_official: z.boolean(),
  statement_md: z.string().max(12000),
  asset_ids: z.array(z.string().min(1).max(128)).min(0).max(100),
  status: z.string().max(12000),
  issues: z.array(z.string().max(12000)).min(0).max(30),
});
export type PublicProblem = z.infer<typeof PublicProblemSchema>;

// PublicMessage
export const PublicMessageSchema = z.strictObject({
  id: z.string().min(1).max(128),
  role: z.enum(["student", "teacher", "system"]),
  text_md: z.string().max(12000),
  created_at: z.iso.datetime(),
});
export type PublicMessage = z.infer<typeof PublicMessageSchema>;

// PublicGoal
export const PublicGoalSchema = z.strictObject({
  goal_key: z.string().min(1).max(128),
  label: z.string().max(12000),
  origin: z.enum(["student", "teacher", "coauthored"]),
  status: z.string().max(12000),
});
export type PublicGoal = z.infer<typeof PublicGoalSchema>;

// PublicAttempt
export const PublicAttemptSchema = z.strictObject({
  id: z.string().min(1).max(128),
  task_id: z.string().min(1).max(128),
  plan_md: z.string().max(12000).nullable(),
  plan_locked: z.boolean(),
  answer_md: z.string().max(12000).nullable(),
  assistance_requested: z.boolean(),
  help_exposed: z.boolean(),
  finished: z.boolean(),
});
export type PublicAttempt = z.infer<typeof PublicAttemptSchema>;

// StudentView
export const StudentViewSchema = z.strictObject({
  session_id: z.string().min(1).max(128),
  version: z.int().min(1),
  phase: z.enum(["preparing", "study", "check_plan", "check_answer", "summary"]),
  problem: PublicProblemSchema,
  active_task_prompt_md: z.string().max(12000),
  messages: z.array(PublicMessageSchema).min(0).max(500),
  current_goal: PublicGoalSchema.nullable(),
  attempt: PublicAttemptSchema.nullable(),
  notice: z.string().max(12000),
  allowed_actions: z.array(z.string().min(1).max(128)).min(0).max(100),
  run_status: z.enum(["idle", "queued", "preparing", "diagnosing", "planning", "rendering", "checking", "grading", "failed"]),
  can_start_check: z.boolean(),
});
export type StudentView = z.infer<typeof StudentViewSchema>;

// AttemptReport
export const AttemptReportSchema = z.strictObject({
  attempt_id: z.string().min(1).max(128),
  task_id: z.string().min(1).max(128),
  relation: z.enum(["near_transfer", "near_duplicate"]),
  planning: z.enum(["correct", "incorrect", "unknown", "unanswered"]),
  execution: z.enum(["correct", "incorrect", "unknown", "unanswered"]),
  independent_planning: z.boolean(),
  independent_execution: z.boolean(),
  independent_task_pass: z.boolean(),
  assistance_requested: z.boolean(),
  help_exposed: z.boolean(),
  invalidated: z.boolean(),
  limitations: z.array(z.string().max(12000)).min(0).max(30),
});
export type AttemptReport = z.infer<typeof AttemptReportSchema>;

// Report
export const ReportSchema = z.strictObject({
  session_id: z.string().min(1).max(128),
  original_status: z.enum(["in_progress", "incomplete", "unknown", "completed_with_help", "completed_without_recorded_help"]),
  attempts: z.array(AttemptReportSchema).min(0).max(30),
  observations: z.array(z.string().max(12000)).min(0).max(30),
  limitations: z.array(z.string().max(12000)).min(0).max(30),
  delayed_evidence: z.literal("not_evaluated"),
});
export type Report = z.infer<typeof ReportSchema>;

// ModelCallRecord
export const ModelCallRecordSchema = z.strictObject({
  role: z.enum(["preparation", "diagnosis", "strategy", "assessment", "renderer", "guard", "vision"]),
  model: z.string().max(12000),
  prompt_version: z.string().min(1).max(128),
  input_hash: z.string().regex(new RegExp("^[0-9a-f]{64}$")),
  attempt: z.int().min(1),
  input_tokens: z.int().min(0),
  output_tokens: z.int().min(0),
  usage_kind: z.enum(["reported", "estimated", "unknown"]),
  elapsed_ms: z.int().min(0),
  result_status: z.enum(["succeeded", "failed", "unknown"]),
});
export type ModelCallRecord = z.infer<typeof ModelCallRecordSchema>;

// RunRecord
export const RunRecordSchema = z.strictObject({
  id: z.string().min(1).max(128),
  session_id: z.string().min(1).max(128).nullable(),
  workflow: z.enum(["prepare", "turn", "transcribe", "grade"]),
  request_id: z.string().min(1).max(128),
  expected_version: z.int().min(0),
  lease_token: z.string().min(1).max(128),
  deadline_at: z.iso.datetime(),
  status: z.enum(["queued", "running", "succeeded", "failed", "expired", "cancelled"]),
  calls: z.array(ModelCallRecordSchema).min(0).max(20),
  created_at: z.iso.datetime(),
});
export type RunRecord = z.infer<typeof RunRecordSchema>;

// SelectInput
export const SelectInputSchema = z.strictObject({
  mode: z.enum(["random", "specified"]),
  problem_id: z.string().min(1).max(128).nullable(),
  bank_version: z.string().min(1).max(128),
  request_id: z.string().min(1).max(128),
});
export type SelectInput = z.infer<typeof SelectInputSchema>;

// TurnInput
export const TurnInputSchema = z.strictObject({
  session_id: z.string().min(1).max(128),
  expected_version: z.int().min(1),
  request_id: z.string().min(1).max(128),
  action: z.enum(["attempt", "hint", "explain", "worked_solution", "finish_problem", "propose_route", "skip_goal", "reveal_route"]),
  text_md: z.string().max(12000),
  transcript_id: z.string().min(1).max(128).nullable(),
  transcript_revision: z.int().min(1).nullable(),
});
export type TurnInput = z.infer<typeof TurnInputSchema>;

// ConfirmTranscriptInput
export const ConfirmTranscriptInputSchema = z.strictObject({
  transcript_id: z.string().min(1).max(128),
  expected_revision: z.int().min(1),
  request_id: z.string().min(1).max(128),
  lines: z.array(TranscriptLineSchema).min(1).max(200),
});
export type ConfirmTranscriptInput = z.infer<typeof ConfirmTranscriptInputSchema>;

// CheckInput
export const CheckInputSchema = z.strictObject({
  session_id: z.string().min(1).max(128),
  expected_version: z.int().min(1),
  request_id: z.string().min(1).max(128),
  action: z.enum(["start", "save_draft", "submit_plan", "finish", "help", "reassess"]),
  attempt_id: z.string().min(1).max(128).nullable(),
  plan_md: z.string().max(12000).nullable(),
  answer_md: z.string().max(12000).nullable(),
  help_text: z.string().max(12000),
});
export type CheckInput = z.infer<typeof CheckInputSchema>;

// CorrectionInput
export const CorrectionInputSchema = z.strictObject({
  session_id: z.string().min(1).max(128),
  expected_version: z.int().min(1),
  request_id: z.string().min(1).max(128),
  submission_id: z.string().min(1).max(128),
  expected_revision: z.int().min(1),
  corrected_text_md: z.string().max(12000),
});
export type CorrectionInput = z.infer<typeof CorrectionInputSchema>;

// TeacherInput
export const TeacherInputSchema = z.strictObject({
  session_id: z.string().min(1).max(128),
  expected_version: z.int().min(1),
  request_id: z.string().min(1).max(128),
  confirm_exposure: z.literal(true),
});
export type TeacherInput = z.infer<typeof TeacherInputSchema>;

// MutationInput
export const MutationInputSchema = z.strictObject({
  session_id: z.string().min(1).max(128),
  expected_version: z.int().min(1),
  request_id: z.string().min(1).max(128),
});
export type MutationInput = z.infer<typeof MutationInputSchema>;

// Error
export const ErrorSchema = z.strictObject({
  code: z.enum(["UNAUTHORIZED", "NOT_FOUND", "INVALID_INPUT", "VERSION_CONFLICT", "REQUEST_CONFLICT", "BUSY", "NOT_READY", "TIMEOUT", "MODEL_ERROR", "RATE_LIMITED", "BUDGET_EXCEEDED"]),
  message: z.string().max(12000),
  retryable: z.boolean(),
  selected_problem_id: z.string().min(1).max(128).nullable(),
});
export type DomainError = z.infer<typeof ErrorSchema>;

// DiagnosisInput
export const DiagnosisInputSchema = z.strictObject({
  task_id: z.string().min(1).max(128),
  prompt_md: z.string().max(12000),
  decisions: z.array(DecisionSchema).min(1).max(24),
  routes: z.array(RouteSchema).min(1).max(8),
  confirmed_evidence: z.array(SubmissionSchema).min(0).max(100),
  previous_hypotheses: z.array(HypothesisSchema).min(0).max(30),
  previous_probes: z.array(ProbeProposalSchema).min(0).max(20),
  private_reference_md: z.string().max(12000),
});
export type DiagnosisInput = z.infer<typeof DiagnosisInputSchema>;

// StrategyInput
export const StrategyInputSchema = z.strictObject({
  diagnosis: DiagnosisSchema,
  user_action: z.string().max(12000),
  exposures: z.array(ExposureSchema).min(0).max(500),
  remaining_probes: z.int().min(0),
  remaining_calls: z.int().min(0),
  route_patch: RoutePatchSchema.nullable(),
  decisions: z.array(DecisionSchema).min(1).max(24),
  private_reference_md: z.string().max(12000),
});
export type StrategyInput = z.infer<typeof StrategyInputSchema>;

// PreparationInput
export const PreparationInputSchema = z.strictObject({
  mode: z.enum(["prepare", "route_review"]),
  problem: ProblemSchema,
  reference_material_md: z.string().max(12000),
  student_route_md: z.string().max(12000).nullable(),
  evidence_refs: z.array(EvidenceRefSchema).min(0).max(100),
});
export type PreparationInput = z.infer<typeof PreparationInputSchema>;

// AssessmentInput
export const AssessmentInputSchema = z.strictObject({
  task: CheckTaskSchema,
  locked_plan_md: z.string().max(12000),
  final_answer_md: z.string().max(12000),
});
export type AssessmentInput = z.infer<typeof AssessmentInputSchema>;

// GuardInput
export const GuardInputSchema = z.strictObject({
  mode: z.enum(["packet", "route", "message", "assessment"]),
  task_id: z.string().min(1).max(128),
  candidate_json: z.string().max(12000),
  reference_md: z.string().max(12000),
  allowed_disclosures: z.array(z.string().min(1).max(128)).min(0).max(100),
  reserved_decisions: z.array(z.string().min(1).max(128)).min(0).max(100),
});
export type GuardInput = z.infer<typeof GuardInputSchema>;

// 便于按名字动态取用（FixtureProvider 与契约映射测试使用）。
export const SCHEMA_BY_NAME = {
  EvidenceRef: EvidenceRefSchema,
  Verification: VerificationSchema,
  Problem: ProblemSchema,
  Decision: DecisionSchema,
  Route: RouteSchema,
  CheckTask: CheckTaskSchema,
  Packet: PacketSchema,
  RoutePatch: RoutePatchSchema,
  TranscriptLine: TranscriptLineSchema,
  TranscriptDraft: TranscriptDraftSchema,
  Submission: SubmissionSchema,
  Hypothesis: HypothesisSchema,
  ProbeBranch: ProbeBranchSchema,
  ProbeProposal: ProbeProposalSchema,
  Diagnosis: DiagnosisSchema,
  ApprovedFact: ApprovedFactSchema,
  Strategy: StrategySchema,
  RendererInput: RendererInputSchema,
  RenderedMessage: RenderedMessageSchema,
  GuardResult: GuardResultSchema,
  AssessmentOutput: AssessmentOutputSchema,
  Exposure: ExposureSchema,
  DecisionEvidence: DecisionEvidenceSchema,
  CheckAttempt: CheckAttemptSchema,
  TraceStep: TraceStepSchema,
  SessionState: SessionStateSchema,
  PublicProblem: PublicProblemSchema,
  PublicMessage: PublicMessageSchema,
  PublicGoal: PublicGoalSchema,
  PublicAttempt: PublicAttemptSchema,
  StudentView: StudentViewSchema,
  AttemptReport: AttemptReportSchema,
  Report: ReportSchema,
  ModelCallRecord: ModelCallRecordSchema,
  RunRecord: RunRecordSchema,
  SelectInput: SelectInputSchema,
  TurnInput: TurnInputSchema,
  ConfirmTranscriptInput: ConfirmTranscriptInputSchema,
  CheckInput: CheckInputSchema,
  CorrectionInput: CorrectionInputSchema,
  TeacherInput: TeacherInputSchema,
  MutationInput: MutationInputSchema,
  Error: ErrorSchema,
  DiagnosisInput: DiagnosisInputSchema,
  StrategyInput: StrategyInputSchema,
  PreparationInput: PreparationInputSchema,
  AssessmentInput: AssessmentInputSchema,
  GuardInput: GuardInputSchema,
} as const;

export const SCHEMA_NAMES = [
  "EvidenceRef",
  "Verification",
  "Problem",
  "Decision",
  "Route",
  "CheckTask",
  "Packet",
  "RoutePatch",
  "TranscriptLine",
  "TranscriptDraft",
  "Submission",
  "Hypothesis",
  "ProbeBranch",
  "ProbeProposal",
  "Diagnosis",
  "ApprovedFact",
  "Strategy",
  "RendererInput",
  "RenderedMessage",
  "GuardResult",
  "AssessmentOutput",
  "Exposure",
  "DecisionEvidence",
  "CheckAttempt",
  "TraceStep",
  "SessionState",
  "PublicProblem",
  "PublicMessage",
  "PublicGoal",
  "PublicAttempt",
  "StudentView",
  "AttemptReport",
  "Report",
  "ModelCallRecord",
  "RunRecord",
  "SelectInput",
  "TurnInput",
  "ConfirmTranscriptInput",
  "CheckInput",
  "CorrectionInput",
  "TeacherInput",
  "MutationInput",
  "Error",
  "DiagnosisInput",
  "StrategyInput",
  "PreparationInput",
  "AssessmentInput",
  "GuardInput",
] as const;

export const SCHEMA_NAME_SET: ReadonlySet<string> = new Set(SCHEMA_NAMES);

export type SchemaName = (typeof SCHEMA_NAMES)[number];

export const SCHEMA_CONST_NAMES = [
  "ApprovedFactSchema",
  "AssessmentInputSchema",
  "AssessmentOutputSchema",
  "AttemptReportSchema",
  "CheckAttemptSchema",
  "CheckInputSchema",
  "CheckTaskSchema",
  "ConfirmTranscriptInputSchema",
  "CorrectionInputSchema",
  "DecisionEvidenceSchema",
  "DecisionSchema",
  "DiagnosisInputSchema",
  "DiagnosisSchema",
  "ErrorSchema",
  "EvidenceRefSchema",
  "ExposureSchema",
  "GuardInputSchema",
  "GuardResultSchema",
  "HypothesisSchema",
  "ModelCallRecordSchema",
  "MutationInputSchema",
  "PacketSchema",
  "PreparationInputSchema",
  "ProbeBranchSchema",
  "ProbeProposalSchema",
  "ProblemSchema",
  "PublicAttemptSchema",
  "PublicGoalSchema",
  "PublicMessageSchema",
  "PublicProblemSchema",
  "RenderedMessageSchema",
  "RendererInputSchema",
  "ReportSchema",
  "RoutePatchSchema",
  "RouteSchema",
  "RunRecordSchema",
  "SelectInputSchema",
  "SessionStateSchema",
  "StrategyInputSchema",
  "StrategySchema",
  "StudentViewSchema",
  "SubmissionSchema",
  "TeacherInputSchema",
  "TraceStepSchema",
  "TranscriptDraftSchema",
  "TranscriptLineSchema",
  "TurnInputSchema",
  "VerificationSchema",
] as const;

export type DomainTypeName =
  | 'ApprovedFact'
  | 'AssessmentInput'
  | 'AssessmentOutput'
  | 'AttemptReport'
  | 'CheckAttempt'
  | 'CheckInput'
  | 'CheckTask'
  | 'ConfirmTranscriptInput'
  | 'CorrectionInput'
  | 'Decision'
  | 'DecisionEvidence'
  | 'Diagnosis'
  | 'DiagnosisInput'
  | 'DomainError'
  | 'EvidenceRef'
  | 'Exposure'
  | 'GuardInput'
  | 'GuardResult'
  | 'Hypothesis'
  | 'ModelCallRecord'
  | 'MutationInput'
  | 'Packet'
  | 'PreparationInput'
  | 'ProbeBranch'
  | 'ProbeProposal'
  | 'Problem'
  | 'PublicAttempt'
  | 'PublicGoal'
  | 'PublicMessage'
  | 'PublicProblem'
  | 'RenderedMessage'
  | 'RendererInput'
  | 'Report'
  | 'Route'
  | 'RoutePatch'
  | 'RunRecord'
  | 'SelectInput'
  | 'SessionState'
  | 'Strategy'
  | 'StrategyInput'
  | 'StudentView'
  | 'Submission'
  | 'TeacherInput'
  | 'TraceStep'
  | 'TranscriptDraft'
  | 'TranscriptLine'
  | 'TurnInput'
  | 'Verification';
