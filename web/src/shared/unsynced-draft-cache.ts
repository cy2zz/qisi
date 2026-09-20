export const UNSYNCED_DRAFT_CACHE_TTL_MS = 24 * 60 * 60 * 1_000;

const MAX_DRAFT_CHARS = 12_000;

export interface CachedUnsyncedDraft {
  markdown: string;
  savedAt: number;
  version: 1;
}

export function readCachedUnsyncedDraft(
  storage: Storage,
  key: string,
  now = Date.now(),
): CachedUnsyncedDraft | null {
  try {
    const value = storage.getItem(key);
    if (!value) return null;
    const parsed = JSON.parse(value) as Partial<CachedUnsyncedDraft>;
    const valid = parsed.version === 1
      && typeof parsed.markdown === 'string'
      && parsed.markdown.length <= MAX_DRAFT_CHARS
      && typeof parsed.savedAt === 'number'
      && Number.isFinite(parsed.savedAt)
      && parsed.savedAt <= now + 5 * 60 * 1_000
      && now - parsed.savedAt <= UNSYNCED_DRAFT_CACHE_TTL_MS;
    if (!valid) {
      storage.removeItem(key);
      return null;
    }
    return parsed as CachedUnsyncedDraft;
  } catch {
    try {
      storage.removeItem(key);
    } catch {
      // Storage can be unavailable in private or restricted browser contexts.
    }
    return null;
  }
}

export function writeCachedUnsyncedDraft(
  storage: Storage,
  key: string,
  markdown: string,
  now = Date.now(),
) {
  try {
    if (markdown.length > MAX_DRAFT_CHARS) return false;
    storage.setItem(key, JSON.stringify({ markdown, savedAt: now, version: 1 }));
    return true;
  } catch {
    return false;
  }
}

export function clearCachedUnsyncedDraft(storage: Storage, key: string) {
  try {
    storage.removeItem(key);
  } catch {
    // Server persistence remains authoritative when browser storage is unavailable.
  }
}
