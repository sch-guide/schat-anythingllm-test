const {
  detectQuestionIntent,
  evidenceResultLimit,
  queryTokens,
} = require("../vectorDbProviders/chroma/schatBm25");

const SEARCH_INTENT_TERMS = new Set([
  "절차",
  "방법",
  "순서",
  "단계",
  "시행",
  "준비",
  "확인",
  "관리",
  "평가",
  "사정",
  "점수",
  "기준",
  "종류",
  "목적",
  "주의",
  "주의사항",
]);

function uniqueQueries(values = [], limit = 4) {
  const seen = new Set();
  const queries = [];
  for (const value of values) {
    const query = String(value || "").normalize("NFKC").trim();
    if (!query || seen.has(query)) continue;
    seen.add(query);
    queries.push(query);
    if (queries.length >= limit) break;
  }
  return queries;
}

function searchTopic(tokens = [], fallback = "") {
  const topic = tokens.filter((token) => !SEARCH_INTENT_TERMS.has(token));
  return (topic.length ? topic.join(" ") : fallback).trim();
}

function buildBodySearchQueries(question = "", { maxVariations = 3 } = {}) {
  const original = String(question || "").normalize("NFKC").trim();
  if (!original) return [];

  const variationLimit = Math.max(0, Math.min(3, Number(maxVariations) || 0));
  if (variationLimit === 0) return [original];

  if (/^[A-Z][A-Z0-9-]{1,}$/u.test(original)) {
    return uniqueQueries(
      [
        original,
        `${original} 평가 도구`,
        `${original} 평가 방법`,
        `${original} 사정`,
      ],
      variationLimit + 1
    );
  }

  const tokens = queryTokens(original);
  const topic = searchTopic(tokens, original);
  const hasManagementIntent = tokens.includes("관리");
  const hasAssessmentIntent = tokens.some(
    (token) =>
      token === "평가" ||
      token === "사정" ||
      token.includes("척도") ||
      token === "점수"
  );

  let variations = [];
  if (hasManagementIntent) {
    variations = [
      `${topic} 관리 절차`,
      `${topic} 관리 방법`,
      `${topic} 관리 주의사항`,
    ];
  } else if (detectQuestionIntent(original) === "procedure") {
    variations = [
      `${topic} 시행 절차`,
      `${topic} 준비 확인`,
      `${topic} 단계`,
    ];
  } else if (hasAssessmentIntent) {
    variations = [
      `${topic} 평가 방법`,
      `${topic} 사정`,
      `${topic} 점수 기준`,
    ];
  }

  return uniqueQueries([original, ...variations], variationLimit + 1);
}

function sourceIdentity(source = {}) {
  if (source.id || source.chunk_id) return source.id || source.chunk_id;
  return [
    source.documentId || source.document_id || source.title || "",
    source.page || "",
    source.section || "",
    source.text || "",
  ].join("\u0000");
}

function mergeBodySearchResults(results = [], { limit = 4 } = {}) {
  const ranked = new Map();
  let firstSeen = 0;

  results.forEach((result, queryIndex) => {
    if (!result || result.message) return;
    (result.sources || []).forEach((source, rankIndex) => {
      const key = sourceIdentity(source);
      if (!key) return;
      const current = ranked.get(key) || {
        source,
        score: 0,
        firstSeen: firstSeen++,
      };
      const originalQueryWeight = queryIndex === 0 ? 1.1 : 1;
      current.score += originalQueryWeight / (rankIndex + 1);
      ranked.set(key, current);
    });
  });

  const sources = [...ranked.values()]
    .sort(
      (left, right) =>
        right.score - left.score || left.firstSeen - right.firstSeen
    )
    .slice(0, Math.max(0, Number(limit) || 0))
    .map((entry) => entry.source);

  return {
    contextTexts: sources.map((source) => source.text).filter(Boolean),
    sources,
    relatedImageSources: results[0]?.relatedImageSources || [],
    message: results[0]?.message || false,
  };
}

async function runExpandedBodySearch({
  originalQuestion = "",
  expandedBodyQuery = "",
  topN = 4,
  search,
}) {
  if (typeof search !== "function") throw new Error("search is required");
  const bodyQuery = String(expandedBodyQuery || originalQuestion).trim();
  const queries = buildBodySearchQueries(bodyQuery);
  const results = [];

  for (let index = 0; index < queries.length; index += 1) {
    try {
      results.push(
        await search({
          input: queries[index],
          includeRelatedImages: index === 0,
          ...(index === 0
            ? { relatedImageQueryText: originalQuestion }
            : {}),
        })
      );
    } catch (error) {
      if (index === 0) throw error;
    }
  }

  return mergeBodySearchResults(results, {
    limit: evidenceResultLimit(bodyQuery, topN),
  });
}

module.exports = {
  buildBodySearchQueries,
  mergeBodySearchResults,
  runExpandedBodySearch,
};

