// Employee-facing checklist behaviour only. The stored checklist JSON and the
// administrator modal keep their own item types; this module decides how an
// item is shown as a parent/child checkbox tree on the employee screens.

// Read-only reference rows (purpose, place, transport, definitions, notes)
// never get checkboxes, even when a row was stored as "checkable".
const REFERENCE_LABEL_PATTERN = /목적|장소|이동\s*수단|정의|적응증|참고/;

export function isInformationalItem(item = {}) {
  if (item.type === "informational") return true;
  return REFERENCE_LABEL_PATTERN.test(String(item.label || ""));
}

// "※ ..." remarks and lines made only of a parenthesised explanation are
// reference text inside a checkable item: shown, but never checked.
export function isNoteDetail(detail = "") {
  const text = String(detail).trim();
  return /^※/u.test(text) || /^\([^()]*(?:\([^()]*\)[^()]*)*\)$/u.test(text);
}

/**
 * Whether one detail line gets its own checkbox. An administrator can set it
 * per line (item.detailCheckable[index]); checklists without that setting keep
 * the automatic rule, so existing checklists look exactly as before.
 */
export function isCheckableDetail(item = {}, index = 0) {
  const setting = Array.isArray(item.detailCheckable)
    ? item.detailCheckable[index]
    : undefined;
  if (typeof setting === "boolean") return setting;
  const details = Array.isArray(item.details) ? item.details : [];
  return !isNoteDetail(details[index]);
}

/**
 * Stable state key: checklist + section + item + child. Two checklists with
 * the same label (e.g. "동의서") can therefore never share a checkbox state.
 */
export function detailKey(scope = {}, itemId, index) {
  return [scope.checklistId, scope.sectionId, itemId, index]
    .map((part) => String(part ?? ""))
    .join(":");
}

function childKeys(scope, item = {}) {
  const details = Array.isArray(item.details) ? item.details : [];
  const keys = details
    .map((_, index) =>
      isCheckableDetail(item, index) ? detailKey(scope, item.id, index) : null
    )
    .filter(Boolean);
  if (keys.length === 0) return [detailKey(scope, item.id, "self")];
  return keys;
}

export function parentState(scope, item, checked = {}) {
  const keys = childKeys(scope, item);
  const count = keys.filter((key) => Boolean(checked[key])).length;
  if (count === 0) return "unchecked";
  if (count === keys.length) return "checked";
  return "indeterminate";
}

export function toggleParent(scope, item, checked = {}) {
  const nextValue = parentState(scope, item, checked) !== "checked";
  const next = { ...checked };
  for (const key of childKeys(scope, item)) next[key] = nextValue;
  return next;
}

export function toggleDetail(scope, item, index, checked = {}) {
  const key = detailKey(scope, item.id, index);
  return { ...checked, [key]: !checked[key] };
}
