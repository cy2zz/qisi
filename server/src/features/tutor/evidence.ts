// B04: trusted evidence admission for checked Diagnosis entry points; legacy run() remains schema-only.
import type { Diagnosis, DiagnosisInput, EvidenceRef, Hypothesis, ProbeProposal, Submission } from '../../contracts/domain.schema.js';

export class EvidenceAdmissionError extends Error {
  constructor(readonly code: string) {
    super(`Diagnosis evidence rejected: ${code}`);
    this.name = 'EvidenceAdmissionError';
  }
}

/** Latest revision wins even when it is unconfirmed/invalidated: never fall back to an old revision. */
export function currentEvidence(taskId: string, submissions: readonly Submission[]): Submission[] {
  const latest = new Map<string, Submission>();
  for (const submission of submissions) {
    const old = latest.get(submission.id);
    if (old && old.revision === submission.revision && JSON.stringify(old) !== JSON.stringify(submission)) {
      throw new EvidenceAdmissionError('CONFLICTING_REVISION');
    }
    if (!old || submission.revision > old.revision) latest.set(submission.id, submission);
  }
  return [...latest.values()].filter(s => s.task_id === taskId && s.confirmed && !s.invalidated);
}

export function assertEvidenceReferences(refs: readonly EvidenceRef[], submissions: readonly Submission[]): void {
  const byId = new Map(submissions.map(s => [s.id, s]));
  for (const ref of refs) {
    const s = byId.get(ref.submission_id);
    if (!s || !s.confirmed || s.invalidated || s.revision !== ref.revision) throw new EvidenceAdmissionError('STALE_OR_UNKNOWN_EVIDENCE');
    if (!ref.quote.trim() || !s.text_md.includes(ref.quote)) throw new EvidenceAdmissionError('QUOTE_NOT_PRESENT');
  }
}

/** Structural discrimination is necessary, not proof of pedagogical quality. Human/model review is separate. */
export function assertProbeBranches(probe: ProbeProposal | null, hypotheses: readonly Hypothesis[], goal: string): void {
  if (!probe) return;
  if (probe.goal_key !== goal || !probe.question_md.trim()) throw new EvidenceAdmissionError('PROBE_GOAL_OR_QUESTION');
  const ids = new Set(hypotheses.map(h => h.id));
  const seenIds = new Set<string>();
  const expected = new Set<string>();
  for (const branch of probe.branches) {
    const key = branch.expected.normalize('NFKC').replace(/\s+/gu, '');
    if (!ids.has(branch.hypothesis_id) || seenIds.has(branch.hypothesis_id)) throw new EvidenceAdmissionError('PROBE_HYPOTHESIS');
    if (!key || expected.has(key) || !branch.counter_evidence.trim() || !branch.next_action.trim()
      || key === branch.counter_evidence.normalize('NFKC').replace(/\s+/gu, '')) throw new EvidenceAdmissionError('PROBE_NOT_DISCRIMINATING');
    seenIds.add(branch.hypothesis_id); expected.add(key);
  }
}

export function assertDiagnosisEvidence(diagnosis: Diagnosis, input: DiagnosisInput): void {
  const evidence = currentEvidence(input.task_id, input.confirmed_evidence);
  if (diagnosis.task_id !== input.task_id) throw new EvidenceAdmissionError('TASK_MISMATCH');
  if (!input.decisions.some(d => d.goal_key === diagnosis.focus_goal_key)) throw new EvidenceAdmissionError('UNKNOWN_GOAL');
  const knownDecisions = new Set(input.decisions.map(d => d.id));
  if (diagnosis.satisfied_decision_ids.some(id => !knownDecisions.has(id))) throw new EvidenceAdmissionError('UNKNOWN_DECISION');
  if (diagnosis.judgment === 'unknown' && diagnosis.satisfied_decision_ids.length) throw new EvidenceAdmissionError('UNKNOWN_IS_NOT_MASTERY');
  if (diagnosis.judgment !== 'unknown' && !diagnosis.evidence_refs.length) throw new EvidenceAdmissionError('JUDGMENT_WITHOUT_EVIDENCE');
  assertEvidenceReferences(diagnosis.evidence_refs, evidence);
  const ids = new Set<string>();
  for (const h of diagnosis.hypotheses) {
    if (ids.has(h.id)) throw new EvidenceAdmissionError('DUPLICATE_HYPOTHESIS');
    ids.add(h.id);
    assertEvidenceReferences(h.evidence_refs, evidence);
    if ((h.status === 'supported' || h.status === 'refuted') && !h.evidence_refs.length) throw new EvidenceAdmissionError('HYPOTHESIS_WITHOUT_EVIDENCE');
  }
  assertProbeBranches(diagnosis.probe, diagnosis.hypotheses, diagnosis.focus_goal_key);
}
