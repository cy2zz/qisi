import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { CorrectionInput, Packet, SessionState } from '../../src/contracts/domain.schema.js';
import { applyCorrection } from '../../src/features/tutor/corrections.js';
function setup() {
 const read = (name: string): unknown => JSON.parse(readFileSync(new URL(`../../../qisi-sdd-v3/fixtures/${name}.json`, import.meta.url), 'utf8'));
 const state = read('session') as SessionState; const packet = read('packet') as Packet; const old = state.submissions[0]!;
 const input: CorrectionInput = { session_id: state.id, expected_version: state.version, request_id: 'correction-1', submission_id: old.id, expected_revision: old.revision, corrected_text_md: 'corrected by student' };
 return { state, packet, input, old };
}
describe('B06 revision invalidation without rewriting history', () => {
 it('preserves old revision, first attempts and exposure while invalidating conclusions', () => {
  const { state, packet, input, old } = setup(); const before = structuredClone(state);
  const next = applyCorrection(state, input, packet.decisions, '2026-09-20T08:00:00.000Z');
  expect(state).toEqual(before); expect(next.version).toBe(state.version + 1);
  expect(next.submissions.find(s => s.id === old.id && s.revision === old.revision)?.invalidated).toBe(true);
  expect(next.submissions.at(-1)).toMatchObject({ revision: old.revision + 1, text_md: input.corrected_text_md, confirmed: true });
  expect(next.exposures).toEqual(state.exposures); expect(next.attempts).toEqual(state.attempts);
  expect(next.traces.filter(t => t.submission_id === old.id).every(t => t.invalidated)).toBe(true);
 });
 it.each(['revision', 'version', 'session', 'empty'] as const)('rejects %s conflict', kind => {
  const { state, packet, input } = setup();
  if (kind === 'revision') input.expected_revision++;
  if (kind === 'version') input.expected_version++;
  if (kind === 'session') input.session_id = 'other';
  if (kind === 'empty') input.corrected_text_md = ' ';
  expect(() => applyCorrection(state, input, packet.decisions, '2026-09-20T08:00:00.000Z')).toThrow();
 });
});
