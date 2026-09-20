import {
  clearCachedUnsyncedDraft,
  readCachedUnsyncedDraft,
  UNSYNCED_DRAFT_CACHE_TTL_MS,
  writeCachedUnsyncedDraft,
} from '../../shared/unsynced-draft-cache';

export const LEARNING_DRAFT_CACHE_PREFIX = 'qisi:learning-draft:v1:';
export const LEARNING_DRAFT_CACHE_TTL_MS = UNSYNCED_DRAFT_CACHE_TTL_MS;

export function learningDraftCacheKey(sessionId: string) {
  return `${LEARNING_DRAFT_CACHE_PREFIX}${encodeURIComponent(sessionId)}`;
}

export function readCachedLearningDraft(
  storage: Storage,
  sessionId: string,
  now = Date.now(),
) {
  return readCachedUnsyncedDraft(storage, learningDraftCacheKey(sessionId), now);
}

export function writeCachedLearningDraft(
  storage: Storage,
  sessionId: string,
  markdown: string,
  now = Date.now(),
) {
  return writeCachedUnsyncedDraft(
    storage,
    learningDraftCacheKey(sessionId),
    markdown,
    now,
  );
}

export function clearCachedLearningDraft(storage: Storage, sessionId: string) {
  clearCachedUnsyncedDraft(storage, learningDraftCacheKey(sessionId));
}
