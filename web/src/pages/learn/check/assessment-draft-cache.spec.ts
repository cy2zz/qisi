import { beforeEach, describe, expect, it } from 'vitest';
import {
  assessmentDraftCacheKey,
  clearCachedAssessmentDraft,
  readCachedAssessmentDraft,
  writeCachedAssessmentDraft,
} from './assessment-draft-cache';

describe('assessment draft cache', () => {
  beforeEach(() => localStorage.clear());

  it('isolates the first plan and final answer for the same attempt', () => {
    expect(writeCachedAssessmentDraft(localStorage, '81', 'check_plan', '先配方', 1_000))
      .toBe(true);
    expect(writeCachedAssessmentDraft(localStorage, '81', 'check_answer', '最小值为 $-4$', 1_001))
      .toBe(true);

    expect(readCachedAssessmentDraft(localStorage, '81', 'check_plan', 2_000)?.markdown)
      .toBe('先配方');
    expect(readCachedAssessmentDraft(localStorage, '81', 'check_answer', 2_000)?.markdown)
      .toBe('最小值为 $-4$');

    clearCachedAssessmentDraft(localStorage, '81', 'check_plan');
    expect(localStorage.getItem(assessmentDraftCacheKey('81', 'check_plan'))).toBeNull();
    expect(readCachedAssessmentDraft(localStorage, '81', 'check_answer', 2_000)?.markdown)
      .toBe('最小值为 $-4$');
  });
});
