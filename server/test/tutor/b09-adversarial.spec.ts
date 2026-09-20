import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { GuardResult, Packet, RoutePatch, SessionState } from '../../src/contracts/domain.schema.js';
import { applyCorrection } from '../../src/features/tutor/corrections.js';
import { admitReviewedRoute } from '../../src/agents/strategy/route-admission.js';
const fixture = <T,>(name: string): T => JSON.parse(readFileSync(new URL(`../../../qisi-sdd-v3/fixtures/${name}.json`, import.meta.url), 'utf8')) as T;

describe('B09 synthetic adversarial regressions (not model-quality holdout)', () => {
  it('invalidates transitive conclusions whose corrected source appears only inside a hypothesis', () => {
    const state = fixture<SessionState>('session');
    const packet = fixture<Packet>('packet');
    const old = state.submissions[0]!;
    const trace = state.traces[0]!;
    trace.submission_id = 'different-submission';
    trace.diagnosis!.evidence_refs = [];
    trace.diagnosis!.satisfied_decision_ids = ['d1'];
    state.decision_evidence = packet.decisions.map(d => ({ decision_id: d.id, goal_key: d.goal_key, origin: 'student', status: 'valid', help_exposed: false, evidence_refs: [] }));
    const next = applyCorrection(state, { session_id: state.id, expected_version: state.version, request_id: 'nested-source', submission_id: old.id, expected_revision: old.revision, corrected_text_md: 'a corrected student statement' }, packet.decisions, '2026-09-20T08:00:00Z');
    expect(next.decision_evidence.filter(d => ['d1', 'd2', 'd3'].includes(d.decision_id)).map(d => d.status)).toEqual(['invalidated', 'invalidated', 'invalidated']);
    expect(next.decision_evidence.find(d => d.decision_id === 'd4')?.status).toBe('valid');
    expect(next.exposures).toEqual(state.exposures);
    expect(next.traces[0]?.invalidated).toBe(true);
  });

  it.each(['fail', 'unknown'] as const)('does not select one pass while ignoring a %s route review', status => {
    const state = fixture<SessionState>('session');
    const packet = fixture<Packet>('packet');
    const submission = state.submissions[0]!;
    const ref = { submission_id: submission.id, revision: submission.revision, quote: submission.text_md };
    const review = { kind: 'model_checked' as const, reviewer_or_model: 'fixture', reference: 'review-1', summary: 'synthetic', status: 'pass' as const, checked_at: '2026-09-20T08:00:00Z' };
    const patch: RoutePatch = { task_id: state.active_task_id, new_decisions: [{ ...packet.decisions[0]!, id: 'alternative', goal_key: 'alternative-goal', source: 'student', prerequisite_ids: [] }], new_routes: [{ id: 'alternative-route', note: 'synthetic route', source: 'student', decision_ids: ['alternative'], terminal_ids: ['alternative'], math_status: 'valid', evidence_refs: [ref] }], evidence_refs: [ref], math_status: 'valid', verification: [review, { ...review, reference: 'review-2', status }], blocking_issues: [] };
    expect(admitReviewedRoute({ taskId: state.active_task_id, current: { decisions: packet.decisions, routes: packet.routes }, patch, guard: fixture<GuardResult>('guard'), submissions: state.submissions })).toBeNull();
  });
});
