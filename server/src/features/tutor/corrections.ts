import { CorrectionInputSchema, SessionStateSchema, type CorrectionInput, type Decision, type EvidenceRef, type SessionState } from '../../contracts/domain.schema.js';

/** Pure mutation candidate. Caller must persist with owner/Origin/CAS/idempotency/lease checks. */
export function applyCorrection(state: SessionState, raw: CorrectionInput, decisions: readonly Decision[], now: string): SessionState {
  const input = CorrectionInputSchema.parse(raw);
  if (state.id !== input.session_id) throw new Error('NOT_FOUND');
  if (state.version !== input.expected_version) throw new Error('VERSION_CONFLICT');
  if (!input.corrected_text_md.trim() || !Number.isFinite(Date.parse(now))) throw new Error('INVALID_INPUT');
  const old = state.submissions.filter(s => s.id === input.submission_id).sort((a, b) => b.revision - a.revision)[0];
  if (!old) throw new Error('NOT_FOUND');
  if (old.revision !== input.expected_revision || old.invalidated) throw new Error('REVISION_CONFLICT');
  const next = structuredClone(state);
  const refers = (refs: readonly EvidenceRef[]) => refs.some(r => r.submission_id === old.id && r.revision <= old.revision);
  const affected = new Set(next.decision_evidence.filter(e => refers(e.evidence_refs)).map(e => e.decision_id));
  for (const trace of next.traces) {
    const refs = [...(trace.diagnosis?.evidence_refs ?? []), ...(trace.diagnosis?.hypotheses.flatMap(h => h.evidence_refs) ?? []), ...(trace.strategy?.route_patch?.evidence_refs ?? [])];
    if (trace.submission_id === old.id || refers(refs)) {
      for (const id of trace.diagnosis?.satisfied_decision_ids ?? []) affected.add(id);
    }
  }
  // Bounded transitive closure: a corrected prerequisite invalidates dependent decisions.
  for (let pass = 0; pass < decisions.length; pass++) {
    const size = affected.size;
    for (const d of decisions) if (d.prerequisite_ids.some(id => affected.has(id))) affected.add(d.id);
    if (size === affected.size) break;
  }
  const affectedGoals = new Set(decisions.filter(d => affected.has(d.id)).map(d => d.goal_key));
  for (const s of next.submissions) if (s.id === old.id) s.invalidated = true;
  next.submissions.push({ ...old, revision: old.revision + 1, text_md: input.corrected_text_md, confirmed: true, invalidated: false, created_at: now });
  for (const e of next.decision_evidence) if (affected.has(e.decision_id)) e.status = 'invalidated';
  for (const trace of next.traces) {
    const refs = [...(trace.diagnosis?.evidence_refs ?? []), ...(trace.diagnosis?.hypotheses.flatMap(h => h.evidence_refs) ?? []), ...(trace.strategy?.route_patch?.evidence_refs ?? [])];
    if (trace.submission_id === old.id || refers(refs) || (trace.diagnosis && affectedGoals.has(trace.diagnosis.focus_goal_key))) trace.invalidated = true;
  }
  // Independent first plan/answer never overwritten; same-task attempt remains as invalidated history.
  for (const attempt of next.attempts) if (attempt.task_id === old.task_id) attempt.invalidated = true;
  if (old.task_id === next.problem_id) next.original_result = 'unknown';
  next.version++;
  return SessionStateSchema.parse(next);
}
