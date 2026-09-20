import type { TraceCommit } from './teacher.port.js';
/** Whitelist, not a copy of private SessionState/TraceStep. No packet, route, rubric or raw model IO. */
export function projectTeacherTrace(receipt: TraceCommit) {
 const traces = receipt.traces.filter(t => t.task_id === receipt.taskId);
 const runIds = new Set(traces.map(t => t.run_id));
 return {
  session_id: receipt.sessionId, task_id: receipt.taskId, version: receipt.version,
  exposure: 'whole_task' as const,
  traces: traces.map(t => ({
   turn_id: t.turn_id, invalidated: t.invalidated, created_at: t.created_at,
   shown_text_md: t.shown_text_md,
   evidence: (t.diagnosis?.evidence_refs ?? []).map(r => ({ submission_id: r.submission_id, revision: r.revision, quote: r.quote })),
   diagnosis: t.diagnosis ? { judgment: t.diagnosis.judgment, summary: t.diagnosis.summary,
    hypotheses: t.diagnosis.hypotheses.map(h => ({ id: h.id, kind: h.kind, status: h.status, explanation: h.explanation, missing_evidence: h.missing_evidence })) } : null,
   strategy: t.strategy ? { action: t.strategy.action, intervention: t.strategy.intervention, scaffold_level: t.strategy.scaffold_level, decision_reason: t.strategy.decision_reason, fading_reason: t.strategy.fading_reason, expected_student_artifact: t.strategy.expected_student_artifact } : null,
   probe: t.strategy?.probe ? { question_md: t.strategy.probe.question_md, ordinal: t.probe_ordinal, branches: t.strategy.probe.branches.map(b => ({ hypothesis_id: b.hypothesis_id, expected: b.expected, counter_evidence: b.counter_evidence, next_action: b.next_action })) } : null,
   guard: t.guard ? { verdict: t.guard.verdict, actual_disclosed_ids: [...t.guard.actual_disclosed_ids], whole_task_disclosed: t.guard.whole_task_disclosed } : null,
  })),
  runs: receipt.runs.filter(r => r.session_id === receipt.sessionId && runIds.has(r.id)).map(r => ({
   id: r.id, workflow: r.workflow, status: r.status,
   calls: r.calls.map(c => ({ role: c.role, model: c.model, prompt_version: c.prompt_version, attempt: c.attempt, input_tokens: c.input_tokens, output_tokens: c.output_tokens, usage_kind: c.usage_kind, elapsed_ms: c.elapsed_ms, result_status: c.result_status })),
  })),
  limitations: ['决策摘要不是模型隐藏思维链；单次教学表现不等于学生已学会。'],
 };
}
export type TeacherTraceView = ReturnType<typeof projectTeacherTrace>;
