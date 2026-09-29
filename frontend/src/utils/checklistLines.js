// Administrator line editing for one checklist item. Every change keeps the
// optional per-line checkbox setting (item.detailCheckable) aligned with
// item.details. An item without that setting keeps the automatic rule until
// the administrator changes a line checkbox.
import { isCheckableDetail } from "./checklistTree.js";

const details = (item = {}) =>
  Array.isArray(item.details) ? [...item.details] : [];
const hasSetting = (item = {}) => Array.isArray(item.detailCheckable);

function withLines(item, nextDetails, nextSetting) {
  const next = { ...item, details: nextDetails };
  if (nextSetting) next.detailCheckable = nextSetting;
  else delete next.detailCheckable;
  return next;
}

export function updateLine(item, index, text) {
  const next = details(item);
  next[index] = text;
  return withLines(item, next, hasSetting(item) && [...item.detailCheckable]);
}

export function addLine(item) {
  return withLines(
    item,
    [...details(item), ""],
    hasSetting(item) && [...item.detailCheckable, true]
  );
}

export function removeLine(item, index) {
  const keep = (_, position) => position !== index;
  return withLines(
    item,
    details(item).filter(keep),
    hasSetting(item) && item.detailCheckable.filter(keep)
  );
}

export function moveLine(item, index, direction) {
  const target = index + direction;
  const lines = details(item);
  if (target < 0 || target >= lines.length) return item;
  const swap = (list) => {
    const copy = [...list];
    [copy[index], copy[target]] = [copy[target], copy[index]];
    return copy;
  };
  return withLines(
    item,
    swap(lines),
    hasSetting(item) && swap(item.detailCheckable)
  );
}

/** Turns one line's checkbox on/off; the first change records every line. */
export function setLineCheckable(item, index, value) {
  const setting = details(item).map((_, position) =>
    isCheckableDetail(item, position)
  );
  setting[index] = Boolean(value);
  return withLines(item, details(item), setting);
}

/** What is saved: trimmed lines, blank lines removed with their setting. */
export function cleanItemLines(item) {
  const lines = details(item).map((line) => String(line ?? "").trim());
  const keep = lines.map(Boolean);
  return withLines(
    item,
    lines.filter((_, position) => keep[position]),
    hasSetting(item) &&
      item.detailCheckable.filter((_, position) => keep[position])
  );
}
