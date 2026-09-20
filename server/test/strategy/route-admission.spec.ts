import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { GuardResult, Packet, RoutePatch, SessionState } from '../../src/contracts/domain.schema.js';
import { admitReviewedRoute } from '../../src/agents/strategy/route-admission.js';
function setup() {
 const read = (name: string): unknown => JSON.parse(readFileSync(new URL(`../../../qisi-sdd-v3/fixtures/${name}.json`, import.meta.url), 'utf8'));
 const packet = read('packet') as Packet; const state = read('session') as SessionState;
 const evidence = { submission_id: state.submissions[0]!.id, revision: 1, quote: state.submissions[0]!.text_md };
 const patch: RoutePatch = { task_id: state.active_task_id, new_decisions: [{ ...packet.decisions[0]!, id: 'student-alt', goal_key: 'student-alt-goal', source: 'student', prerequisite_ids: [] }], new_routes: [{ id: 'student-route', note: 'fixture alternative', source: 'student', decision_ids: ['student-alt'], terminal_ids: ['student-alt'], math_status: 'valid', evidence_refs: [evidence] }], evidence_refs: [evidence], math_status: 'valid', verification: [{ kind: 'model_checked', reviewer_or_model: 'fixture', reference: 'review-1', summary: 'checked fixture only', status: 'pass', checked_at: '2026-09-20T00:00:00Z' }], blocking_issues: [] };
 return { taskId: state.active_task_id, current: { decisions: packet.decisions, routes: packet.routes }, patch, guard: read('guard') as GuardResult, submissions: state.submissions };
}
describe('B05 reviewed alternate route boundary', () => {
 it('preserves student provenance without changing existing graph', () => {
  const input = setup(); const before = structuredClone(input.current); expect(admitReviewedRoute(input)?.new_routes[0]?.source).toBe('student'); expect(input.current).toEqual(before);
 });
 it.each(['guard-unknown','foreign-task','fabricated-ref','no-verification','route-unknown'] as const)('keeps %s patch pending', kind => {
  const input = setup();
  if (kind === 'guard-unknown') input.guard.verdict = 'unknown';
  if (kind === 'foreign-task') input.patch.task_id = 'other';
  if (kind === 'fabricated-ref') input.patch.evidence_refs[0]!.quote = 'invented';
  if (kind === 'no-verification') input.patch.verification = [];
  if (kind === 'route-unknown') input.patch.new_routes[0]!.math_status = 'unknown';
  expect(admitReviewedRoute(input)).toBeNull();
 });
});
