import type { Decision, DecisionEvidence, Exposure, Submission } from '../../contracts/domain.schema.js';
import { currentEvidence, assertEvidenceReferences, EvidenceAdmissionError } from './evidence.js';
export interface LadderInput {
  taskId: string; decisions: readonly Decision[]; evidence: readonly DecisionEvidence[];
  submissions: readonly Submission[]; exposures: readonly Exposure[];
  recentAttempts: readonly DecisionEvidence[]; scaffoldLevel: number;
}
/** Candidates only: a skip/fade is not independent transfer evidence or a learned verdict. */
export function proposeLadder(input: LadderInput) {
  if (!Number.isInteger(input.scaffoldLevel) || input.scaffoldLevel < 0 || input.scaffoldLevel > 4) throw new Error('INVALID_SCAFFOLD_LEVEL');
  const current = currentEvidence(input.taskId, input.submissions);
  const known = new Map(input.decisions.map(d => [d.id, d]));
  const independent = (item: DecisionEvidence): boolean => {
    const decision = known.get(item.decision_id);
    if (!decision || decision.goal_key !== item.goal_key || item.status !== 'valid' || item.origin !== 'student' || item.help_exposed || !item.evidence_refs.length) return false;
    if (input.exposures.some(e => e.task_id === input.taskId && (e.scope === 'whole_task' || e.decision_ids.includes(item.decision_id)))) return false;
    try { assertEvidenceReferences(item.evidence_refs, current); return true; } catch (error) {
      if (error instanceof EvidenceAdmissionError) return false;
      throw error;
    }
  };
  const skip = new Set(input.evidence.filter(independent).map(e => e.decision_id));
  const recent = input.recentAttempts.slice(-2);
  // A single submission/revision cannot count twice, even under different decision IDs.
  const refs = recent.map(e => new Set(e.evidence_refs.map(r => `${r.submission_id}:${r.revision}`)));
  const twoDistinct = recent.length === 2 && recent.every(independent) && ![...refs[0]!].some(r => refs[1]!.has(r));
  return {
    skipDecisionIds: [...skip],
    availableDecisionIds: input.decisions.filter(d => !skip.has(d.id) && d.prerequisite_ids.every(id => skip.has(id))).map(d => d.id),
    scaffoldCandidate: twoDistinct ? Math.max(0, input.scaffoldLevel - 1) : input.scaffoldLevel,
    learned: false as const,
  };
}
