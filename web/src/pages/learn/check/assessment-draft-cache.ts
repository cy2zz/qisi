import {
  clearCachedUnsyncedDraft,
  readCachedUnsyncedDraft,
  writeCachedUnsyncedDraft,
} from '../../../shared/unsynced-draft-cache';

export type AssessmentDraftPhase = 'check_answer' | 'check_plan';

export const ASSESSMENT_DRAFT_CACHE_PREFIX = 'qisi:assessment-draft:v1:';

export function assessmentDraftCacheKey(
  attemptId: string,
  phase: AssessmentDraftPhase,
) {
  return `${ASSESSMENT_DRAFT_CACHE_PREFIX}${encodeURIComponent(attemptId)}:${phase}`;
}

export function readCachedAssessmentDraft(
  storage: Storage,
  attemptId: string,
  phase: AssessmentDraftPhase,
  now = Date.now(),
) {
  return readCachedUnsyncedDraft(
    storage,
    assessmentDraftCacheKey(attemptId, phase),
    now,
  );
}

export function writeCachedAssessmentDraft(
  storage: Storage,
  attemptId: string,
  phase: AssessmentDraftPhase,
  markdown: string,
  now = Date.now(),
) {
  return writeCachedUnsyncedDraft(
    storage,
    assessmentDraftCacheKey(attemptId, phase),
    markdown,
    now,
  );
}

export function clearCachedAssessmentDraft(
  storage: Storage,
  attemptId: string,
  phase: AssessmentDraftPhase,
) {
  clearCachedUnsyncedDraft(storage, assessmentDraftCacheKey(attemptId, phase));
}
