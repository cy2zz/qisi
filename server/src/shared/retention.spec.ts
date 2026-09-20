import { describe, expect, it } from 'vitest';
import { retentionCutoffs } from './retention.js';

describe('retention cutoffs', () => {
  it('clears temporary drafts after 24 hours and sessions after their persisted expiry', () => {
    const now = new Date('2026-09-19T12:00:00.000Z');

    expect(retentionCutoffs(now)).toEqual({
      draftBefore: new Date('2026-09-18T12:00:00.000Z'),
      sessionExpiresAtOrBefore: now,
    });
  });
});
