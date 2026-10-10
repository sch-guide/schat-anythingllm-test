// Employee checklist checks are kept in this browser per user and checklist,
// so closing and reopening a checklist (panel, separate window, reload or
// another thread) keeps what was already checked until 체크 모두 해제.
// Only checkbox keys are stored, never patient information.

const KEY_PREFIX = "schat_checklist_checks";

export function checklistChecksKey(userId, checklistId) {
  return `${KEY_PREFIX}:${userId ?? "guest"}:${checklistId}`;
}

// Stored value -> { [checkboxKey]: true }. Broken or foreign values give an
// empty checklist instead of an error.
export function parseChecklistChecks(raw) {
  if (!raw) return {};
  try {
    const value = JSON.parse(raw);
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    return Object.fromEntries(
      Object.entries(value).filter(([, checked]) => checked === true)
    );
  } catch {
    return {};
  }
}

// Only checked boxes are written; null means "nothing checked, remove key".
export function serializeChecklistChecks(checked = {}) {
  const kept = Object.fromEntries(
    Object.entries(checked).filter(([, value]) => value === true)
  );
  return Object.keys(kept).length ? JSON.stringify(kept) : null;
}

export function loadChecklistChecks(storage, key) {
  try {
    return parseChecklistChecks(storage?.getItem(key));
  } catch {
    return {};
  }
}

export function saveChecklistChecks(storage, key, checked) {
  try {
    const value = serializeChecklistChecks(checked);
    if (value === null) storage?.removeItem(key);
    else storage?.setItem(key, value);
  } catch {
    // Storage blocked or full: checks still work for this screen.
  }
}
