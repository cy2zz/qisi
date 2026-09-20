import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import type { DecisionEvidence, Packet, SessionState } from '../../src/contracts/domain.schema.js';
import { proposeLadder, type LadderInput } from '../../src/features/tutor/ladder.js';
function setup(): LadderInput {
  const read = (name: string): unknown => JSON.parse(readFileSync(new URL(`../../../qisi-sdd-v3/fixtures/${name}.json`, import.meta.url), 'utf8'));
  const packet = read('packet') as Packet;
  const state = read('session') as SessionState;
  const submission = state.submissions[0]!;
  const evidence: DecisionEvidence = { decision_id: packet.decisions[0]!.id, goal_key: packet.decisions[0]!.goal_key, status: 'valid', origin: 'student', help_exposed: false, evidence_refs: [{ submission_id: submission.id, revision: submission.revision, quote: submission.text_md }] };
  const second = { ...submission, id: 'independent-second' };
  return { taskId: submission.task_id, decisions: packet.decisions, evidence: [evidence], submissions: [submission, second], exposures: [], recentAttempts: [evidence, { ...evidence, evidence_refs: [{ ...evidence.evidence_refs[0]!, submission_id: second.id }] }], scaffoldLevel: 3 };
}
describe('B05 evidence-driven ladder candidates', () => {
  it('skips a verified independent artifact and suggests fading after two distinct trials', () => {
    const input = setup(); const result = proposeLadder(input);
    expect(result.skipDecisionIds).toEqual([input.decisions[0]!.id]);
    expect(result.scaffoldCandidate).toBe(2); expect(result.learned).toBe(false);
  });
  it('does not mistake replay of one submission for two trials', () => {
    const input = setup(); input.recentAttempts = [input.evidence[0]!, input.evidence[0]!];
    expect(proposeLadder(input).scaffoldCandidate).toBe(3);
  });
  it.each(['teacher', 'unknown', 'invalidated', 'help', 'stale'] as const)('does not skip %s evidence', kind => {
    const input = setup(); const item = input.evidence[0]!;
    if (kind === 'teacher') item.origin = 'teacher';
    if (kind === 'unknown' || kind === 'invalidated') item.status = kind;
    if (kind === 'help') item.help_exposed = true;
    if (kind === 'stale') input.submissions = [...input.submissions, { ...input.submissions[0]!, revision: 2, confirmed: false }];
    expect(proposeLadder(input).skipDecisionIds).toEqual([]);
    expect(proposeLadder(input).scaffoldCandidate).toBe(3);
  });
  it('retains prerequisite constraints instead of offering all future decisions', () => {
    const input = setup(); input.evidence = []; input.recentAttempts = [];
    expect(proposeLadder(input).availableDecisionIds).toEqual(input.decisions.filter(d => d.prerequisite_ids.length === 0).map(d => d.id));
  });
});
