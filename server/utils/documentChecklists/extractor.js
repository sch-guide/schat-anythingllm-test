const crypto = require("node:crypto");

const RENAL_BIOPSY_ALIASES = Object.freeze([
  "renal biopsy",
  "renal bx",
  "신장 조직검사",
  "신생검",
]);

const SECTION_DEFINITIONS = Object.freeze([
  {
    title: "검사 전",
    marker: "검사전",
    items: [
      ["검사목적", "informational"],
      ["동의서", "checkable"],
      ["금식여부", "checkable"],
      ["IV line", "checkable"],
      ["검사 전 준비", "checkable"],
      ["Prepare", "checkable"],
      ["검사장소/이동수단", "checkable"],
    ],
  },
  {
    title: "검사 후",
    marker: "검사후",
    items: [
      ["식이", "checkable"],
      ["자세", "checkable"],
      ["X-ray 및 Lab", "checkable"],
      ["관찰사항", "checkable"],
    ],
  },
]);

function compact(value = "") {
  return String(value).replace(/\s+/g, "").toLowerCase();
}

function sourceContains(source, value) {
  const needle = compact(value);
  return needle.length > 0 && compact(source).includes(needle);
}

function stableId(...parts) {
  return crypto
    .createHash("sha256")
    .update(parts.map((part) => String(part ?? "")).join("\u0000"))
    .digest("hex")
    .slice(0, 24);
}

function compactMap(value = "") {
  const raw = String(value);
  let normalized = "";
  const rawIndex = [];

  for (let index = 0; index < raw.length; index += 1) {
    const character = raw[index];
    if (/\s/u.test(character)) continue;
    normalized += character.toLowerCase();
    rawIndex.push(index);
  }

  return { raw, normalized, rawIndex };
}

function locate(mapping, label, from = 0) {
  const needle = compact(label);
  const start = mapping.normalized.indexOf(needle, from);
  if (start < 0) return null;
  const end = start + needle.length;
  return {
    compactStart: start,
    compactEnd: end,
    rawStart: mapping.rawIndex[start],
    rawEnd: mapping.rawIndex[end - 1] + 1,
  };
}

function splitDetails(value = "") {
  return String(value)
    .split(/\r?\n/u)
    .flatMap((line) => {
      const trimmed = line.trim();
      if (!/[①②③④⑤⑥⑦⑧⑨⑩]/u.test(trimmed)) return [trimmed];
      return (
        trimmed.match(/[①②③④⑤⑥⑦⑧⑨⑩][^①②③④⑤⑥⑦⑧⑨⑩]*/gu) ||
        [trimmed]
      );
    })
    .map((line) => line.trim())
    .filter(Boolean);
}

function parseSection(mapping, definition, sectionStart, sectionEnd) {
  const located = [];
  let cursor = sectionStart;

  for (const [label, type] of definition.items) {
    const range = locate(mapping, label, cursor);
    if (!range || range.compactStart >= sectionEnd) return null;
    located.push({ label, type, range });
    cursor = range.compactEnd;
  }

  const items = located.map((entry, index) => {
    const next = located[index + 1];
    const rawEnd = next
      ? next.range.rawStart
      : mapping.rawIndex[Math.max(sectionEnd - 1, 0)] + 1;
    const details = splitDetails(
      mapping.raw.slice(entry.range.rawEnd, rawEnd)
    ).filter((detail) => sourceContains(mapping.raw, detail));

    return {
      id: stableId(definition.title, entry.label),
      type: entry.type,
      label: entry.label,
      details,
    };
  });

  if (items.some((entry) => !sourceContains(mapping.raw, entry.label)))
    return null;

  return {
    id: stableId(definition.title),
    title: definition.title,
    items,
  };
}

function isRenalBiopsyChecklistCandidate(text = "") {
  const normalized = compact(text);
  return (
    (normalized.includes("신장조직검사") ||
      normalized.includes("renalbiopsy")) &&
    normalized.includes("검사전") &&
    normalized.includes("검사후") &&
    normalized.includes("검사목적") &&
    normalized.includes("동의서") &&
    normalized.includes("금식여부") &&
    normalized.includes("ivline") &&
    normalized.includes("관찰사항")
  );
}

function extractRenalBiopsyChecklist({
  documentId,
  filename,
  page,
  text,
} = {}) {
  if (!documentId || Number(page) !== 56) return null;
  if (!/검사\s*및\s*시술.*\.pdf$/iu.test(String(filename || ""))) return null;
  if (!isRenalBiopsyChecklistCandidate(text)) return null;

  const mapping = compactMap(text);
  const beforeMarker = locate(mapping, "검사전");
  const afterMarker = locate(
    mapping,
    "검사후",
    beforeMarker?.compactEnd ?? 0
  );
  if (!beforeMarker || !afterMarker) return null;

  const before = parseSection(
    mapping,
    SECTION_DEFINITIONS[0],
    beforeMarker.compactEnd,
    afterMarker.compactStart
  );
  const after = parseSection(
    mapping,
    SECTION_DEFINITIONS[1],
    afterMarker.compactEnd,
    mapping.normalized.length
  );
  if (!before || !after) return null;

  const requiredLabels = [
    "검사목적",
    "동의서",
    "금식여부",
    "IV line",
    "검사 전 준비",
    "Prepare",
    "관찰사항",
  ];
  const labels = new Set(
    [...before.items, ...after.items].map((entry) => entry.label)
  );
  if (requiredLabels.some((label) => !labels.has(label))) return null;

  const now = new Date().toISOString();
  return {
    version: 1,
    id: stableId(documentId, page, "renal-biopsy"),
    documentId: String(documentId),
    page: 56,
    title: "신장조직검사 Renal biopsy",
    aliases: [...RENAL_BIOPSY_ALIASES],
    sections: [before, after],
    source: {
      filename: String(filename),
      page: 56,
    },
    status: "active",
    active: true,
    autoGenerated: true,
    editedByAdmin: false,
    createdAt: now,
    updatedAt: now,
  };
}

module.exports = {
  RENAL_BIOPSY_ALIASES,
  isRenalBiopsyChecklistCandidate,
  extractRenalBiopsyChecklist,
  sourceContains,
};
