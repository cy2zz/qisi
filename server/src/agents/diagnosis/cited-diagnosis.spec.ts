import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { DiagnosisSchema, type DiagnosisInput, type Submission } from '../../contracts/domain.schema.js';
import { citedDiagnosisProtocol } from './cited-diagnosis.js';

function submission(patch: Partial<Submission> = {}): Submission {
  return { id: 'current', task_id: 'task', revision: 1, confirmed: true, invalidated: false,
    source: 'typed', text_md: 'C53＝10；2³＝8。\r\n所以系数80。', media_id: null, transcript_id: null,
    created_at: '2026-09-30T00:00:00.000Z', ...patch };
}
function input(evidence: Submission[] = [submission()]): DiagnosisInput {
  return { task_id: 'task', confirmed_evidence: evidence, decisions: [], routes: [], previous_hypotheses: [],
    previous_probes: [], private_reference_md: '', prompt_md: 'fixture problem' };
}
function candidate(refs: unknown[]) {
  return { task_id: 'task', judgment: 'valid', evidence_refs: refs, focus_goal_key: 'goal',
    hypotheses: [{ id: 'h1', kind: 'strategy', status: 'candidate', explanation: 'fixture', missing_evidence: '', evidence_refs: refs }],
    probe: null, satisfied_decision_ids: [], route_review_needed: false, route_review_reason: '', summary: 'fixture' };
}
describe('chat diagnosis citation wire protocol', () => {
  it('resolves both evidence locations to exact original characters without normalizing mathematics', () => {
    const protocol = citedDiagnosisProtocol(input());
    const actual = protocol.resolve(candidate([{ evidence_key: 'e0' }]));
    const ref = { submission_id: 'current', revision: 1, quote: submission().text_md };
    expect(actual.evidence_refs).toEqual([ref]);
    expect(actual.hypotheses[0]?.evidence_refs).toEqual([ref]);
    expect(DiagnosisSchema.safeParse(actual).success).toBe(true);
    expect(actual).not.toHaveProperty('evidence_catalog');
  });
  it('keeps chronology, makes the current entry e0, and has a provider-serializable wire schema', () => {
    const protocol = citedDiagnosisProtocol(input([submission({ id: 'old' }), submission()]));
    expect(protocol.input.confirmed_evidence.map(s => s.id)).toEqual(['old', 'current']);
    expect(protocol.input.evidence_catalog.map(e => [e.evidence_key, e.submission_id])).toEqual([['e0','current'], ['e1','old']]);
    expect(() => z.toJSONSchema(protocol.schema)).not.toThrow();
    expect(JSON.stringify(z.toJSONSchema(protocol.schema))).toContain('evidence_key');
  });
  it.each([
    { confirmed: false }, { invalidated: true }, { task_id: 'foreign' },
  ])('does not issue keys for inadmissible evidence: %j', patch => {
    const protocol = citedDiagnosisProtocol(input([submission(patch)]));
    expect(protocol.input.evidence_catalog).toEqual([]);
    expect(() => protocol.resolve(candidate([{ evidence_key: 'e0' }]))).toThrow();
    expect(() => z.toJSONSchema(protocol.schema)).not.toThrow();
  });
  it.each([{ confirmed: false }, { invalidated: true }, {}])('never reverts to an old revision: %j', patch => {
    const protocol = citedDiagnosisProtocol(input([submission(), submission({ revision: 2, text_md: 'new', ...patch })]));
    expect(protocol.input.evidence_catalog.every(e => e.revision === 2)).toBe(true);
    expect(protocol.input.evidence_catalog.some(e => e.quote === submission().text_md)).toBe(false);
  });
  it('rejects conflicting copies of the same revision instead of selecting one', () => {
    expect(() => citedDiagnosisProtocol(input([submission(), submission({ text_md: 'different' })]))).toThrow('CONFLICTING_REVISION');
  });
  it.each([
    { evidence_key: 'unknown' },
    { evidence_key: 'e0', quote: 'invented' },
    { evidence_key: 'e0', submission_id: 'foreign', revision: 1, quote: 'invented' },
  ])('rejects unknown or mixed references without silently repairing text: %j', ref => {
    expect(() => citedDiagnosisProtocol(input()).resolve(candidate([ref]))).toThrow();
  });
  it('preserves literal references for the caller semantic gate, never replaces fabricated text with a trusted quote', () => {
    const ref = { submission_id: 'current', revision: 1, quote: 'fabricated' };
    const actual = citedDiagnosisProtocol(input()).resolve(candidate([ref]));
    expect(actual.evidence_refs).toEqual([ref]);
    expect(actual.hypotheses[0]?.evidence_refs).toEqual([ref]);
  });
});
