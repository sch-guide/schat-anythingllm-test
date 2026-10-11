// Employee notes on a checklist (환자정보, 기타메모). They may hold patient
// names and rooms, so they never leave this browser: no API call, no server
// log, no RAG/Citation/Gemini input, and they are kept apart from the
// checklist JSON and from the saved checks.
//
// A note belongs to one user, one login session and one checklist. Notes of
// another user or an earlier session are removed when a checklist opens, on
// logout, and 12 hours after the last edit.

const KEY_PREFIX = "schat_checklist_memo";
export const MEMO_TTL_MS = 12 * 60 * 60 * 1000;
export const MEMO_FIELDS = ["patient", "other"];

// Login session marker derived from the auth token; the token itself is never
// stored. FNV-1a, only to tell sessions apart.
export function memoSessionId(authToken) {
  if (!authToken) return "local";
  let hash = 0x811c9dc5;
  for (let i = 0; i < authToken.length; i++) {
    hash ^= authToken.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16);
}

export function checklistMemoPrefix(userId, sessionId) {
  return `${KEY_PREFIX}:${userId ?? "guest"}:${sessionId}:`;
}

export function checklistMemoKey(userId, sessionId, checklistId) {
  return `${checklistMemoPrefix(userId, sessionId)}${checklistId}`;
}

const EMPTY = Object.freeze({ patient: "", other: "", updatedAt: null });

export function parseChecklistMemo(raw, now = Date.now()) {
  if (!raw) return EMPTY;
  try {
    const value = JSON.parse(raw);
    if (!value || typeof value !== "object") return EMPTY;
    const updatedAt = Number.isFinite(value.updatedAt) ? value.updatedAt : null;
    if (updatedAt === null || now - updatedAt > MEMO_TTL_MS) return EMPTY;
    return {
      patient: typeof value.patient === "string" ? value.patient : "",
      other: typeof value.other === "string" ? value.other : "",
      updatedAt,
    };
  } catch {
    return EMPTY;
  }
}

export function hasMemo(memo = {}) {
  return MEMO_FIELDS.some((field) => String(memo[field] || "").trim());
}

export function loadChecklistMemo(storage, key, now = Date.now()) {
  try {
    return parseChecklistMemo(storage?.getItem(key), now);
  } catch {
    return EMPTY;
  }
}

export function saveChecklistMemo(storage, key, memo, now = Date.now()) {
  try {
    if (!hasMemo(memo)) return storage?.removeItem(key);
    storage?.setItem(
      key,
      JSON.stringify({
        patient: String(memo.patient || ""),
        other: String(memo.other || ""),
        updatedAt: now,
      })
    );
  } catch {
    // Storage blocked or full: the note still works on this screen.
  }
}

function memoKeys(storage) {
  const keys = [];
  for (let i = 0; i < (storage?.length || 0); i++) {
    const key = storage.key(i);
    if (key?.startsWith(`${KEY_PREFIX}:`)) keys.push(key);
  }
  return keys;
}

/**
 * Removes notes that must not be shown any more: another user's or an
 * earlier session's (keepPrefix not matching), and expired ones. Without
 * keepPrefix every note is removed (logout).
 */
export function purgeChecklistMemos(
  storage,
  keepPrefix = null,
  now = Date.now()
) {
  try {
    for (const key of memoKeys(storage)) {
      const keep =
        keepPrefix &&
        key.startsWith(keepPrefix) &&
        hasMemo(parseChecklistMemo(storage.getItem(key), now));
      if (!keep) storage.removeItem(key);
    }
  } catch {
    // Storage blocked: nothing was saved either.
  }
}
