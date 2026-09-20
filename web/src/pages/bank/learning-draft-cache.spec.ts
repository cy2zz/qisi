import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearCachedLearningDraft,
  LEARNING_DRAFT_CACHE_TTL_MS,
  learningDraftCacheKey,
  readCachedLearningDraft,
  writeCachedLearningDraft,
} from './learning-draft-cache';

describe('learning draft cache', () => {
  beforeEach(() => localStorage.clear());

  it('keeps only a bounded unsynced draft for the current session', () => {
    expect(writeCachedLearningDraft(localStorage, '91', '步骤 1：移项', 1_000)).toBe(true);
    expect(readCachedLearningDraft(localStorage, '91', 2_000)).toEqual({
      markdown: '步骤 1：移项',
      savedAt: 1_000,
      version: 1,
    });
    expect(readCachedLearningDraft(localStorage, '92', 2_000)).toBeNull();
  });

  it('removes expired, malformed, and cleared drafts', () => {
    expect(writeCachedLearningDraft(localStorage, '91', '未同步草稿', 1_000)).toBe(true);
    expect(readCachedLearningDraft(localStorage, '91', 1_000 + LEARNING_DRAFT_CACHE_TTL_MS + 1))
      .toBeNull();
    expect(localStorage.getItem(learningDraftCacheKey('91'))).toBeNull();

    localStorage.setItem(learningDraftCacheKey('91'), '{invalid');
    expect(readCachedLearningDraft(localStorage, '91', 2_000)).toBeNull();
    expect(writeCachedLearningDraft(localStorage, '91', '', 3_000)).toBe(true);
    expect(readCachedLearningDraft(localStorage, '91', 3_001)?.markdown).toBe('');
    clearCachedLearningDraft(localStorage, '91');
    expect(localStorage.getItem(learningDraftCacheKey('91'))).toBeNull();
  });
});
