// Employee checklist checks are kept in this browser per user and checklist,
// so closing and reopening a checklist (panel, separate window, reload or
// another thread) keeps what was already checked until 체크 모두 해제.
// Only checkbox keys and the time of the last change are stored, never
// patient information.

const KEY_PREFIX = "schat_checklist_checks";

export function checklistChecksKey(userId, checklistId) {
  return `${KEY_PREFIX}:${userId ?? "guest"}:${checklistId}`;
}

function onlyChecked(value = {}) {
  return Object.fromEntries(
    Object.entries(value).filter(([, checked]) => checked === true)
  );
}

const EMPTY = Object.freeze({ checks: {}, updatedAt: null });

// Stored value -> { checks: { [checkboxKey]: true }, updatedAt: ms | null }.
// A plain { key: true } object (no time saved) is still read. Broken or
// foreign values give an empty checklist instead of an error.
export function parseChecklistChecks(raw) {
  if (!raw) return EMPTY;
  try {
    const value = JSON.parse(raw);
    if (!value || typeof value !== "object" || Array.isArray(value))
      return EMPTY;
    if (value.checks && typeof value.checks === "object") {
      return {
        checks: onlyChecked(value.checks),
        updatedAt: Number.isFinite(value.updatedAt) ? value.updatedAt : null,
      };
    }
    return { checks: onlyChecked(value), updatedAt: null };
  } catch {
    return EMPTY;
  }
}

// Only checked boxes are written; null means "nothing checked, remove key".
export function serializeChecklistChecks(checked = {}, updatedAt = Date.now()) {
  const checks = onlyChecked(checked);
  return Object.keys(checks).length
    ? JSON.stringify({ checks, updatedAt })
    : null;
}

export function loadChecklistChecks(storage, key) {
  try {
    return parseChecklistChecks(storage?.getItem(key));
  } catch {
    return EMPTY;
  }
}

export function saveChecklistChecks(storage, key, checked, now = Date.now()) {
  try {
    const value = serializeChecklistChecks(checked, now);
    if (value === null) storage?.removeItem(key);
    else storage?.setItem(key, value);
  } catch {
    // Storage blocked or full: checks still work for this screen.
  }
}

export function hasChecks(checked = {}) {
  return Object.values(checked).some(Boolean);
}

// "방금 전", "5분 전", "3시간 전", "2일 전"; null when the time is unknown.
export function elapsedLabel(updatedAt, now = Date.now()) {
  if (!Number.isFinite(updatedAt)) return null;
  const minutes = Math.floor(Math.max(0, now - updatedAt) / 60000);
  if (minutes < 1) return "방금 전";
  if (minutes < 60) return `${minutes}분 전`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}시간 전`;
  return `${Math.floor(hours / 24)}일 전`;
}
