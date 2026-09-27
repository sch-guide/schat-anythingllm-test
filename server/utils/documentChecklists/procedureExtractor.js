const crypto = require("node:crypto");

// One template shared by every standard procedure page of the nursing
// "검사 및 시술" handbook (the layout already verified on Renal biopsy p.56).
// Nothing here adds clinical content: labels, details, titles and aliases are
// copied from the page and each one is verified against the page text.
const STANDARD_TEMPLATE = Object.freeze([
  {
    title: "검사 전",
    marker: "검사전",
    items: [
      { label: "검사목적", type: "informational", alternatives: ["시술목적"] },
      { label: "동의서", type: "checkable" },
      { label: "금식여부", type: "checkable" },
      { label: "IV line", type: "checkable", inline: true },
      {
        label: "검사 전 준비",
        type: "checkable",
        alternatives: ["시술 전 준비", "수술 전 준비"],
      },
      { label: "Prepare", type: "checkable" },
      {
        label: "검사장소/이동수단",
        type: "informational",
        alternatives: ["시술장소/이동수단"],
      },
    ],
  },
  {
    title: "검사 후",
    marker: "검사후",
    items: [
      { label: "식이", type: "checkable" },
      { label: "자세", type: "checkable" },
      { label: "X-ray 및 Lab", type: "checkable" },
      { label: "관찰사항", type: "checkable" },
    ],
  },
]);

const CIRCLED = /[①②③④⑤⑥⑦⑧⑨⑩]/u;
const LIST_START = /^(?:[①②③④⑤⑥⑦⑧⑨⑩]|[-·•*※<]|\d+[.)])/u;
const EMPTY_DETAIL = new Set(["-", "–", "—"]);
const GENERIC_ALIAS = new Set([
  "검사",
  "시술",
  "수술",
  "병동",
  "소아",
  "성인",
  "신경외과",
  "심장내과",
  "신장내과",
  "인터벤션",
]);

function compact(value = "") {
  return String(value).replace(/\s+/g, "").toLowerCase();
}

function stableId(...parts) {
  return crypto
    .createHash("sha256")
    .update(parts.map((part) => String(part ?? "")).join("\u0000"))
    .digest("hex")
    .slice(0, 24);
}

function textLines(text = "") {
  return String(text)
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean);
}

function labelVariants(item) {
  return [item.label, ...(item.alternatives || [])];
}

function hasBranchMarker(text = "") {
  return textLines(text).some(
    (line) => /^<[^>]+>$/u.test(line) || /경우>$/u.test(line)
  );
}

/** Cheap text-only gate before any PDF layout work. */
function isStandardProcedurePage(text = "") {
  const normalized = compact(text);
  if (!normalized || hasBranchMarker(text)) return false;
  let cursor = 0;
  for (const section of STANDARD_TEMPLATE) {
    const marker = normalized.indexOf(section.marker, cursor);
    if (marker < 0) return false;
    cursor = marker + section.marker.length;
    for (const item of section.items) {
      const hits = labelVariants(item)
        .map((label) => ({
          at: normalized.indexOf(compact(label), cursor),
          label,
        }))
        .filter((hit) => hit.at >= 0)
        .sort((a, b) => a.at - b.at);
      if (!hits.length) return false;
      cursor = hits[0].at + compact(hits[0].label).length;
    }
  }
  return true;
}

function joinItems(items = []) {
  let out = "";
  let previous = null;
  for (const item of items) {
    if (previous) {
      const gap = item.x - (previous.x + previous.w);
      if (gap > 1.5 && !/\s$/u.test(out) && !/^\s/u.test(item.str)) out += " ";
    }
    out += item.str;
    previous = item;
  }
  return out.replace(/\s+/gu, " ").trim();
}

function visualLines(items = []) {
  const lines = [];
  for (const item of items) {
    const current = lines[lines.length - 1];
    const tolerance = Math.max(2, (item.h || 10) * 0.3);
    if (current && Math.abs(current.y - item.y) <= tolerance) {
      current.items.push(item);
    } else {
      lines.push({ y: item.y, items: [item] });
    }
  }
  return lines.map((line) => {
    const first = line.items[0];
    const last = line.items[line.items.length - 1];
    return {
      y: line.y,
      startX: first.x,
      endX: last.x + last.w,
      firstWidth: first.w,
      text: joinItems(line.items),
    };
  });
}

/**
 * Restores sentences broken only by the cell width: a line continues the
 * previous one when the previous line ran up to the cell's right edge so the
 * next line's first word could not fit, and the next line does not start a
 * new list entry.
 */
function logicalLines(lines = [], { contentLeft, cellRight }) {
  const out = [];
  for (const line of lines) {
    const previous = out[out.length - 1];
    const room = cellRight - (previous?.endX ?? 0);
    const alignedLeft = Math.abs(line.startX - contentLeft) <= 3;
    const hangingIndent =
      previous?.listItem &&
      line.startX > contentLeft + 3 &&
      line.startX <= contentLeft + 25;
    const wrapped =
      previous &&
      (alignedLeft || hangingIndent) &&
      !LIST_START.test(line.text) &&
      room < line.firstWidth + 3;
    if (wrapped) {
      previous.text += room > 5 ? ` ${line.text}` : line.text;
      previous.endX = line.endX;
    } else {
      out.push({ ...line, listItem: LIST_START.test(line.text) });
    }
  }
  return out;
}

function splitCircled(line = "") {
  if (!CIRCLED.test(line)) return [line];
  const leading = line.split(CIRCLED)[0].trim();
  const parts = line.match(/[①②③④⑤⑥⑦⑧⑨⑩][^①②③④⑤⑥⑦⑧⑨⑩]*/gu) || [];
  return [leading, ...parts].map((part) => part.trim()).filter(Boolean);
}

function flatTemplate() {
  return STANDARD_TEMPLATE.flatMap((section, sectionIndex) =>
    section.items.map((item) => ({ ...item, sectionIndex }))
  );
}

function matchSequence(items, start, target) {
  let text = "";
  for (let index = start; index < items.length; index += 1) {
    text += compact(items[index].str);
    if (text === target) return index;
    if (!target.startsWith(text)) return -1;
  }
  return -1;
}

function isMarkerAt(items, index, marker) {
  const chars = [...marker];
  const run = items.slice(index, index + chars.length);
  if (run.length !== chars.length) return false;
  return run.every(
    (item, offset) =>
      compact(item.str) === chars[offset] && Math.abs(item.x - run[0].x) <= 1.5
  );
}

function titleFromItems(items = []) {
  if (!items.length) return { titleLines: [], subtitleLines: [] };
  const maxHeight = Math.max(...items.map((item) => item.h));
  const lines = visualLines(items);
  const heights = new Map();
  for (const item of items) {
    const key = lines.find(
      (line) => Math.abs(line.y - item.y) <= Math.max(2, item.h * 0.3)
    );
    if (key) heights.set(key, Math.max(heights.get(key) || 0, item.h));
  }
  const titleLines = lines.filter(
    (line) => heights.get(line) >= maxHeight - 0.5
  );
  const otherLines = lines.filter((line) => !titleLines.includes(line));
  return {
    titleLines: titleLines.map((line) => line.text.trim()).filter(Boolean),
    subtitleLines: otherLines.map((line) => line.text.trim()).filter(Boolean),
  };
}

function aliasesFromLine(line = "", { english = false } = {}) {
  const aliases = [];
  const [name, ...qualifiers] = line.split(/[:：]/u);
  if (english) {
    const phrase = name.replace(/[()]/gu, " ").replace(/\s+/gu, " ").trim();
    if (phrase.length >= 6 && /[A-Za-z]/u.test(phrase)) aliases.push(phrase);
    return aliases;
  }
  const tokens = name
    .split(/\s+/u)
    .flatMap(
      (token) => token.match(/[0-9]*[가-힣]+|[A-Za-z][A-Za-z0-9-]*/gu) || []
    );
  // Korean name = consecutive Korean tokens, used as one space-insensitive name.
  let group = [];
  const flushGroup = () => {
    const joined = group.join(" ").trim();
    if (compact(joined).length >= 3 && !GENERIC_ALIAS.has(compact(joined)))
      aliases.push(joined);
    group = [];
  };
  const abbreviation = (token) =>
    /^[A-Za-z]/u.test(token) &&
    (token.match(/[A-Z]/gu) || []).length >= 2 &&
    token.length >= 3 &&
    token.length <= 12;
  // A single English word is used only when it is the whole English name
  // (e.g. "Thoracentesis"), never a generic word of a longer name ("Biopsy").
  const latinWords = tokens.filter((token) => !/[가-힣]/u.test(token)).length;
  for (const token of tokens) {
    if (/[가-힣]/u.test(token)) {
      group.push(token);
      continue;
    }
    flushGroup();
    if (abbreviation(token) || (latinWords === 1 && token.length >= 6))
      aliases.push(token);
  }
  flushGroup();
  const latinRuns = name.match(
    /[A-Za-z][A-Za-z0-9-]*(?:\s+[A-Za-z][A-Za-z0-9-]*)+/gu
  );
  for (const run of latinRuns || []) aliases.push(run.trim());
  // After ":" only an abbreviation is a name (e.g. ": TFCA"); Korean words
  // there are department/location qualifiers and are not aliases.
  for (const qualifier of qualifiers)
    for (const token of qualifier.match(/[A-Za-z][A-Za-z0-9-]*/gu) || [])
      if (abbreviation(token) && !/^prof/iu.test(token)) aliases.push(token);
  return aliases;
}

function aliasesFromTitle(titleLines = [], subtitleLines = []) {
  const aliases = [
    ...titleLines.flatMap((line) => aliasesFromLine(line)),
    ...subtitleLines.flatMap((line) =>
      aliasesFromLine(line, { english: true })
    ),
  ];
  const seen = new Set();
  return aliases.filter((alias) => {
    const key = compact(alias);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function validateAgainstSource(checklist, text) {
  const source = compact(text);
  const problems = [];
  const present = (value) => source.includes(compact(value));
  for (const part of checklist.title.split(" / "))
    if (!present(part)) problems.push("title-not-in-source");
  for (const alias of checklist.aliases)
    if (!present(alias)) problems.push("alias-not-in-source");
  let cursor = 0;
  const labels = new Set();
  for (const section of checklist.sections) {
    for (const item of section.items) {
      const key = `${section.title}\u0000${item.label}`;
      if (labels.has(key)) problems.push("duplicate-item");
      labels.add(key);
      const labelAt = source.indexOf(compact(item.label), cursor);
      if (labelAt < 0) {
        problems.push("label-order-or-missing");
        continue;
      }
      cursor = labelAt + compact(item.label).length;
      const details = new Set();
      for (const detail of item.details) {
        if (details.has(detail)) problems.push("duplicate-detail");
        details.add(detail);
        const at = source.indexOf(compact(detail), cursor);
        if (at < 0) {
          problems.push("detail-order-or-missing");
          continue;
        }
        cursor = at + compact(detail).length;
      }
    }
  }
  return [...new Set(problems)];
}

/**
 * Extracts a checklist from one standard procedure page.
 * Returns null when the page is not a standard checklist page, otherwise a
 * checklist whose status is "active" only when every value is verified.
 */
function extractProcedureChecklist({
  documentId,
  filename,
  page,
  text,
  layout,
} = {}) {
  if (!documentId || !Number.isInteger(Number(page))) return null;
  if (!isStandardProcedurePage(text)) return null;
  if (!layout?.items?.length) return null;

  const height = Number(layout.height) || 842;
  const items = layout.items.filter(
    (item) => item.y <= height * 0.925 && item.y >= height * 0.075
  );
  const expected = flatTemplate();
  const markers = STANDARD_TEMPLATE.map((section) => section.marker);
  const titleItems = [];
  const owned = expected.map(() => []);
  const labelPositions = [];
  let expectedIndex = 0;
  let current = -1;
  let seenMarkers = 0;
  let labelColumnMax = null;

  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    const nextMarker = markers[seenMarkers];
    if (nextMarker && isMarkerAt(items, index, nextMarker)) {
      seenMarkers += 1;
      index += [...nextMarker].length - 1;
      continue;
    }
    const want = expected[expectedIndex];
    const markerReady = want && seenMarkers > want.sectionIndex;
    if (want && markerReady) {
      const positionOk =
        labelColumnMax === null || want.inline || item.x < labelColumnMax;
      let end = -1;
      let matchedLabel = want.label;
      for (const label of positionOk ? labelVariants(want) : []) {
        end = matchSequence(items, index, compact(label));
        if (end >= 0) {
          matchedLabel = label;
          break;
        }
      }
      if (end >= 0) {
        labelPositions[expectedIndex] = {
          x: item.x,
          y: item.y,
          label: matchedLabel,
        };
        current = expectedIndex;
        expectedIndex += 1;
        index = end;
        continue;
      }
    }
    if (current < 0) {
      if (seenMarkers === 0) titleItems.push(item);
      continue;
    }
    if (labelColumnMax === null) labelColumnMax = item.x - 1;
    owned[current].push(item);
  }

  if (expectedIndex !== expected.length || seenMarkers !== markers.length)
    return null;

  const contentItems = owned.flat();
  const contentLeft = labelColumnMax + 1;
  const tableRight = Math.max(...contentItems.map((item) => item.x + item.w));
  const checklistId = stableId(documentId, page, "procedure-checklist");
  const { titleLines, subtitleLines } = titleFromItems(titleItems);
  const title = titleLines.join(" / ");

  const sections = STANDARD_TEMPLATE.map((section, sectionIndex) => ({
    id: stableId(checklistId, section.title),
    title: section.title,
    items: [],
  }));

  const problems = [];
  expected.forEach((entry, index) => {
    const next = expected[index + 1];
    const nextPosition = labelPositions[index + 1];
    const ownLines = visualLines(owned[index]);
    const sameRowInline =
      next?.inline &&
      nextPosition &&
      ownLines.some((line) => Math.abs(line.y - nextPosition.y) <= 3);
    const cellRight = sameRowInline ? nextPosition.x - 1 : tableRight;
    const cellLeft = entry.inline
      ? Math.min(...ownLines.map((line) => line.startX), contentLeft)
      : contentLeft;
    const restored = logicalLines(ownLines, {
      contentLeft: cellLeft,
      cellRight,
    });
    // A second, indented text column inside one cell is a nested table whose
    // reading order cannot be restored safely: keep it for administrator review.
    const indented = restored.filter((line) => line.startX > cellLeft + 20);
    if (!entry.inline && !sameRowInline && indented.length >= 2)
      problems.push("nested-layout");
    const details = restored
      .map((line) => line.text)
      .flatMap(splitCircled)
      .map((detail) => detail.trim())
      .filter(Boolean)
      .filter(
        (detail, position, all) =>
          !EMPTY_DETAIL.has(detail) || all.indexOf(detail) === position
      );
    const onlyEmpty = details.every((detail) => EMPTY_DETAIL.has(detail));
    const label = labelPositions[index]?.label || entry.label;
    sections[entry.sectionIndex].items.push({
      id: stableId(
        checklistId,
        sections[entry.sectionIndex].title,
        entry.label
      ),
      type:
        entry.type === "checkable" && !onlyEmpty
          ? "checkable"
          : "informational",
      label,
      details,
    });
  });

  const checklist = {
    version: 1,
    id: checklistId,
    documentId: String(documentId),
    page: Number(page),
    title,
    aliases: aliasesFromTitle(titleLines, subtitleLines),
    sections,
    source: { filename: String(filename || ""), page: Number(page) },
    autoGenerated: true,
    editedByAdmin: false,
  };

  problems.push(...validateAgainstSource(checklist, text));
  if (!title) problems.push("title-missing");
  if (checklist.aliases.length === 0) problems.push("alias-missing");
  const now = new Date().toISOString();
  return {
    ...checklist,
    status: problems.length ? "needs_review" : "active",
    active: problems.length === 0,
    validation: { problems: [...new Set(problems)] },
    createdAt: now,
    updatedAt: now,
  };
}

module.exports = {
  STANDARD_TEMPLATE,
  isStandardProcedurePage,
  extractProcedureChecklist,
  aliasesFromTitle,
  logicalLines,
  splitCircled,
  compact,
};
