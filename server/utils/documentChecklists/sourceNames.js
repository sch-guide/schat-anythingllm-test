// 체크리스트를 찾을 때 쓰는 이름을 원문 쪽에서 더한다 (2026-10-15).
//
// 수술 문서는 쪽 위에 "병명"(예: 폐암 Lung cancer), 그 아래 "수술명 : 폐엽절제술(Lobectomy),
// 양엽절제술(Bilobectomy)…" 줄이 있다. 체크리스트 이름은 병명으로만 만들어져 있어
// "폐엽절제술", "lobectomy"로 물으면 체크리스트가 뜨지 않았다.
// - 저장된 체크리스트는 바꾸지 않는다. 직원에게 보낼 때 찾기용 이름(searchAliases)에만 더한다.
// - 한 쪽에 체크리스트가 둘 이상이면, 원문 순서(머리글 → 병명 → 수술명 → "수 술 전")로 나눠
//   각 체크리스트의 제목이 들어 있는 부분의 이름만 붙인다.
const fs = require("fs");
const path = require("path");

const NAME_LABEL = /^(?:수\s*술\s*명|시\s*술\s*명|검\s*사\s*명)\s*[:：]\s*(.+)$/u;
const HEADER = /연락주십시오|간호교육파트|업데이트\s*예정/u;
const SECTION_START = new Set(["수술전", "검사전", "시술전"]);
const GENERIC = new Set(["수술", "검사", "시술", "준비", "간호", "수술명", "시술명", "검사명"]);
const NOISE_WORDS = /\b(?:Rt|Lt|or|Both|leg|op|OP)\b/gu;

const compact = (value = "") =>
  String(value).normalize("NFKC").toLowerCase().replace(/[^0-9a-z가-힣]/gu, "");

function addName(list, value) {
  const name = String(value || "").replace(/\s+/gu, " ").trim();
  const key = compact(name);
  if (key.length < 3 || GENERIC.has(key)) return;
  if (!list.some((item) => compact(item) === key)) list.push(name);
}

/** "폐엽절제술(Lobectomy),양엽절제술(Bilobectomy)" → 폐엽절제술, Lobectomy, 양엽절제술, Bilobectomy */
function namesFromNameLine(value = "") {
  const names = [];
  for (const part of String(value).split(/[,，]|\s\/\s|\/(?![^()]*\))|\s또는\s/u)) {
    const korean = part
      .replace(/\([^)]*\)/gu, " ")
      .replace(/[^가-힣\s]/gu, " ");
    addName(names, korean);
    for (const match of part.matchAll(/\(([^)]+)\)/gu))
      for (const english of match[1].split("/"))
        addName(
          names,
          english.replace(NOISE_WORDS, " ").replace(/[^A-Za-z0-9&\s-]/gu, " ")
        );
  }
  return names;
}

/** 병명 줄("경추 추간판 탈출증", "폐암 Lung cancer")에서 한글 이름과 영어 이름 */
function namesFromTitleLine(value = "") {
  const line = String(value).trim();
  if (!line || line.startsWith("[") || HEADER.test(line)) return [];
  const names = [];
  const [name] = line.split(/[:：]/u);
  addName(names, name.replace(/\([^)]*\)/gu, " ").replace(/[^가-힣\s]/gu, " "));
  const latin = name.match(/[A-Za-z][A-Za-z0-9&-]*(?:\s+[A-Za-z][A-Za-z0-9&-]*)+/u);
  if (latin) addName(names, latin[0]);
  return names;
}

/**
 * 쪽 글자를 체크리스트별 "제목 부분"으로 나눈다. 각 부분은 바로 앞 머리글 다음부터
 * "수 술 전"/"검 사 전" 표시 전까지의 줄이다.
 */
function titleAreas(text = "") {
  const lines = String(text).split(/\r?\n/u).map((line) => line.trim());
  const areas = [];
  let start = 0;
  for (let index = 0; index < lines.length; index += 1) {
    if (HEADER.test(lines[index])) {
      start = index + 1;
      continue;
    }
    const one = compact(lines[index]);
    const three = compact(lines.slice(index, index + 3).join(""));
    const marker = SECTION_START.has(one) || SECTION_START.has(three);
    if (!marker) continue;
    const area = lines.slice(Math.max(start, index - 4), index).filter(Boolean);
    if (area.length) areas.push(area);
    start = Number.MAX_SAFE_INTEGER; // 다음 머리글이 나올 때까지 본문
    index += SECTION_START.has(one) ? 0 : 2;
  }
  return areas;
}

function namesFromArea(area = []) {
  const names = [];
  for (const line of area) {
    const label = line.match(NAME_LABEL);
    for (const name of label ? namesFromNameLine(label[1]) : namesFromTitleLine(line))
      addName(names, name);
  }
  return names;
}

/**
 * 한 쪽의 체크리스트들에 원문 이름을 나눠 준다. 제목이 들어 있는 부분을 먼저 짝짓고,
 * 남은 것은 부분 수와 체크리스트 수가 같을 때만 순서대로 짝짓는다.
 * @returns {Map<string, string[]>} 체크리스트 id → 더할 이름
 */
function namesForPage(text, checklists = [], areaValue = namesFromArea) {
  const areas = titleAreas(text);
  const result = new Map();
  const used = new Set();
  const pending = [];
  for (const checklist of checklists) {
    const keys = [checklist.title, ...(checklist.aliases || [])].map(compact).filter((key) => key.length >= 2);
    const index = areas.findIndex(
      (area, position) => !used.has(position) && keys.some((key) => compact(area.join("")).includes(key))
    );
    if (index >= 0) {
      used.add(index);
      result.set(checklist.id, areaValue(areas[index]));
    } else pending.push(checklist);
  }
  const rest = areas.filter((_, position) => !used.has(position));
  if (pending.length && pending.length === rest.length)
    pending.forEach((checklist, index) => result.set(checklist.id, areaValue(rest[index])));
  return result;
}

// 등록 문서 쪽 글자(등록 때 저장된 pageContent). 같은 파일은 다시 읽지 않는다.
const pageTextCache = new Map();
function readPageText(docpath, { documentsPath, readFile }) {
  if (pageTextCache.has(docpath)) return pageTextCache.get(docpath);
  let text = "";
  try {
    const file = path.resolve(documentsPath, docpath);
    if (file.startsWith(path.resolve(documentsPath)))
      text = String(JSON.parse(readFile(file)).pageContent || "");
  } catch {
    text = "";
  }
  if (pageTextCache.size > 3000) pageTextCache.clear();
  pageTextCache.set(docpath, text);
  return text;
}

/**
 * 작업 공간 문서 행과 체크리스트로 체크리스트 id → 원문 이름을 만든다.
 */
function sourceNamesForChecklists(
  checklists = [],
  documents = [],
  {
    documentsPath = require("../files").documentsPath,
    readFile = (file) => fs.readFileSync(file, "utf8"),
    areaValue = namesFromArea,
  } = {}
) {
  const pages = new Map();
  for (const row of documents) {
    let metadata = {};
    try {
      metadata = typeof row.metadata === "string" ? JSON.parse(row.metadata || "{}") : row.metadata || {};
    } catch {
      continue;
    }
    const page = Number(metadata.page);
    if (!metadata.document_id || !Number.isInteger(page) || !row.docpath) continue;
    pages.set(`${metadata.document_id}:${page}`, row.docpath);
  }
  const byPage = new Map();
  for (const checklist of checklists) {
    const key = `${checklist.documentId}:${Number(checklist.page)}`;
    if (!pages.has(key)) continue;
    if (!byPage.has(key)) byPage.set(key, []);
    byPage.get(key).push(checklist);
  }
  const result = new Map();
  for (const [key, group] of byPage) {
    const text = readPageText(pages.get(key), { documentsPath, readFile });
    if (!text) continue;
    for (const [id, names] of namesForPage(text, group, areaValue)) result.set(id, names);
  }
  return result;
}

// 대제목이 같아도 원문에 명시된 수술명·검사명으로 표시를 구분한다.
function sourceTitlesForChecklists(checklists = [], documents = [], options = {}) {
  return sourceNamesForChecklists(checklists, documents, {
    ...options,
    areaValue: (area) => {
      const names = area.map((line) => line.match(NAME_LABEL)?.[1])
        .filter(Boolean).map((name) => name.replace(/\s+/gu, " ").trim());
      return [...new Set(names)].join(" / ");
    },
  });
}

module.exports = {
  namesFromNameLine,
  titleAreas,
  namesForPage,
  sourceNamesForChecklists,
  sourceTitlesForChecklists,
};
