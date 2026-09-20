// B05 pre-render policy. Candidate data never grants independence or writes state.
import type { Strategy, StrategyInput } from '../contracts/domain.schema.js';
import { assertProbeBranches } from '../features/tutor/evidence.js';

export class StrategyAdmissionError extends Error {
  constructor(readonly code: string) { super(`Strategy rejected: ${code}`); this.name = 'StrategyAdmissionError'; }
}
export function assertStrategyPolicy(strategy: Strategy, input: StrategyInput): void {
  const fail = (code: string): never => { throw new StrategyAdmissionError(code); };
  if (strategy.task_id !== input.diagnosis.task_id) fail('TASK_MISMATCH');
  if (!input.decisions.some(d => d.goal_key === strategy.focus_goal_key)) fail('UNKNOWN_GOAL');
  const known = new Set(input.decisions.map(d => d.id));
  const allowed = new Set(strategy.allowed_disclosures);
  const reserved = new Set(strategy.reserved_decisions);
  if ([...allowed, ...reserved].some(id => !known.has(id))) fail('UNKNOWN_DECISION');
  if ([...allowed].some(id => reserved.has(id))) fail('DISCLOSURE_RESERVED_OVERLAP');
  for (const fact of strategy.allowed_facts) {
    if (!fact.text_md.trim() || !fact.source_ref.trim()) fail('FACT_WITHOUT_SOURCE');
    if (fact.decision_ids.some(id => !allowed.has(id))) fail('FACT_NOT_APPROVED');
  }
  if (strategy.probe && input.remaining_probes === 0) fail('PROBE_LIMIT_REACHED');
  assertProbeBranches(strategy.probe, input.diagnosis.hypotheses, strategy.focus_goal_key);
  if ((strategy.action === 'advance' || strategy.action === 'complete') &&
      (input.diagnosis.judgment !== 'valid' || !input.diagnosis.evidence_refs.length || !input.diagnosis.satisfied_decision_ids.length)) fail('ADVANCE_WITHOUT_EVIDENCE');
  if (input.user_action === 'hint' && (strategy.scaffold_level > 1 || strategy.action === 'worked_solution')) fail('MINIMAL_HINT_ESCALATED');
  if (input.user_action === 'worked_solution' && (strategy.probe || strategy.action === 'ask')) fail('EXPLICIT_HELP_FORCED_PROBE');
  // Only the reviewed patch supplied by the domain service can be reused. No model-authored substitute.
  if (strategy.route_patch && (input.route_patch === null || JSON.stringify(strategy.route_patch) !== JSON.stringify(input.route_patch))) fail('UNREVIEWED_ROUTE_PATCH');
  if (strategy.route_patch && (strategy.route_patch.math_status !== 'valid' || strategy.route_patch.blocking_issues.length)) fail('UNVERIFIED_ROUTE_PATCH');
}
