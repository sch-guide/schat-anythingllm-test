// 지침서 원본 보기 자료의 문서 안 글자 검색 (2026-10-15).
// 자료 목록·저장은 guidelineLibraryStore.js. 챗봇용 문서는 원본 보기에 쓰지 않는다.
// ---- 문서 안 글자 검색 ------------------------------------------------------

const MAX_QUERY = 50;
const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** 띄어쓰기·대소문자 차이를 무시하는 검색 패턴. 너무 길거나 비면 null. */
function compileQuery(query = "") {
  const compact = String(query).normalize("NFKC").replace(/\s+/g, "");
  if (!compact || compact.length > MAX_QUERY) return null;
  return new RegExp([...compact].map(escapeRegExp).join("\\s*"), "giu");
}

function snippetAround(text, index, length, radius = 45) {
  const start = Math.max(0, index - radius);
  const end = Math.min(text.length, index + length + radius);
  return {
    before: (start > 0 ? "…" : "") + text.slice(start, index).replace(/\s+/g, " "),
    match: text.slice(index, index + length).replace(/\s+/g, " "),
    after: text.slice(index + length, end).replace(/\s+/g, " ") + (end < text.length ? "…" : ""),
  };
}

/**
 * entries: [{kind, ref, title, page, text}] 를 검색해 쪽 단위 결과를 돌려준다.
 * 문서당 최대 perDocument개, 전체 최대 limit개. 순수 함수.
 */
function searchPageTexts(entries = [], query = "", { limit = 60, perDocument = 20 } = {}) {
  const pattern = compileQuery(query);
  if (!pattern) return { hits: [], total: 0 };
  const perDoc = new Map();
  const hits = [];
  let total = 0;
  const sorted = [...entries].sort(
    (a, b) => a.title.localeCompare(b.title, "ko") || a.page - b.page
  );
  for (const entry of sorted) {
    const text = String(entry.text || "").normalize("NFKC");
    pattern.lastIndex = 0;
    const matches = [...text.matchAll(pattern)];
    if (!matches.length) continue;
    total += 1;
    const key = `${entry.kind}:${entry.ref}`;
    const count = perDoc.get(key) || 0;
    if (count >= perDocument || hits.length >= limit) continue;
    perDoc.set(key, count + 1);
    hits.push({
      kind: entry.kind,
      ref: entry.ref,
      title: entry.title,
      page: entry.page,
      matches: matches.length,
      snippet: snippetAround(text, matches[0].index, matches[0][0].length),
    });
  }
  return { hits, total };
}

module.exports = { compileQuery, searchPageTexts };
