/**
 * SCHAT keyword supplement for Chroma vector search.
 *
 * This module is intentionally dependency-free. Gemini/Chroma remains the
 * primary retriever; BM25 only adds a smaller rank contribution for exact
 * Korean clinical terms, English abbreviations, and numeric tokens.
 */

function tokenize(text = "") {
  if (typeof text !== "string") return [];
  return (
    text
      .normalize("NFKC")
      .toLowerCase()
      .match(/[가-힣]+|[a-z0-9]+(?:\.[0-9]+)?/giu) || []
  );
}

function termFrequency(tokens = []) {
  const counts = new Map();
  for (const token of tokens) counts.set(token, (counts.get(token) || 0) + 1);
  return counts;
}

function stableDocumentOrder(left, right) {
  const leftPosition = Number.isFinite(left.corpusPosition)
    ? left.corpusPosition
    : Number.MAX_SAFE_INTEGER;
  const rightPosition = Number.isFinite(right.corpusPosition)
    ? right.corpusPosition
    : Number.MAX_SAFE_INTEGER;
  if (leftPosition !== rightPosition) return leftPosition - rightPosition;
  return String(left.id).localeCompare(String(right.id));
}

function rankByBm25(query = "", documents = [], { k1 = 1.5, b = 0.75 } = {}) {
  const queryTokens = [...new Set(tokenize(query))];
  if (queryTokens.length === 0 || documents.length === 0) return [];

  const prepared = documents.map((document, corpusPosition) => {
    const tokens = tokenize(document.text);
    return {
      ...document,
      corpusPosition: Number.isFinite(document.corpusPosition)
        ? document.corpusPosition
        : corpusPosition,
      tokenCount: tokens.length,
      termCounts: termFrequency(tokens),
    };
  });
  const averageLength =
    prepared.reduce((sum, document) => sum + document.tokenCount, 0) /
      prepared.length || 1;

  const documentFrequency = new Map();
  for (const token of queryTokens) {
    documentFrequency.set(
      token,
      prepared.reduce(
        (count, document) => count + (document.termCounts.has(token) ? 1 : 0),
        0
      )
    );
  }

  return prepared
    .map((document) => {
      let bm25Score = 0;
      let matchedQueryTokens = 0;
      for (const token of queryTokens) {
        const frequency = document.termCounts.get(token) || 0;
        if (frequency === 0) continue;
        matchedQueryTokens += 1;
        const matchedDocuments = documentFrequency.get(token) || 0;
        const inverseDocumentFrequency = Math.log(
          1 +
            (prepared.length - matchedDocuments + 0.5) /
              (matchedDocuments + 0.5)
        );
        const lengthNormalization =
          frequency + k1 * (1 - b + b * (document.tokenCount / averageLength));
        bm25Score +=
          inverseDocumentFrequency *
          ((frequency * (k1 + 1)) / lengthNormalization);
      }
      const { tokenCount, termCounts, ...result } = document;
      return {
        ...result,
        bm25Score,
        bm25Coverage: matchedQueryTokens / queryTokens.length,
      };
    })
    .filter((document) => document.bm25Score > 0)
    .sort((left, right) => {
      if (right.bm25Score !== left.bm25Score)
        return right.bm25Score - left.bm25Score;
      return stableDocumentOrder(left, right);
    });
}

function fuseGeminiAndBm25(
  vectorRanked = [],
  bm25Ranked = [],
  { topN = 4, vectorWeight = 0.75, bm25Weight = 0.25 } = {}
) {
  const candidates = new Map();

  vectorRanked.forEach((candidate, index) => {
    candidates.set(candidate.id, {
      ...candidate,
      retrieval: {
        vectorRank: index + 1,
        bm25Rank: null,
        vectorScore: candidate.vectorScore ?? null,
        bm25Score: null,
        bm25Coverage: 0,
        fusionScore: vectorWeight / (index + 1),
      },
    });
  });

  bm25Ranked.forEach((candidate, index) => {
    const existing = candidates.get(candidate.id) || {
      ...candidate,
      retrieval: {
        vectorRank: null,
        bm25Rank: null,
        vectorScore: null,
        bm25Score: null,
        bm25Coverage: 0,
        fusionScore: 0,
      },
    };
    existing.retrieval.bm25Rank = index + 1;
    existing.retrieval.bm25Score = candidate.bm25Score ?? null;
    existing.retrieval.bm25Coverage = candidate.bm25Coverage ?? 0;
    existing.retrieval.fusionScore += bm25Weight / (index + 1);
    candidates.set(candidate.id, existing);
  });

  const ranked = Array.from(candidates.values()).sort((left, right) => {
    if (right.retrieval.fusionScore !== left.retrieval.fusionScore)
      return right.retrieval.fusionScore - left.retrieval.fusionScore;
    const leftVectorRank = left.retrieval.vectorRank ?? Number.MAX_SAFE_INTEGER;
    const rightVectorRank =
      right.retrieval.vectorRank ?? Number.MAX_SAFE_INTEGER;
    if (leftVectorRank !== rightVectorRank)
      return leftVectorRank - rightVectorRank;
    const leftBm25Rank = left.retrieval.bm25Rank ?? Number.MAX_SAFE_INTEGER;
    const rightBm25Rank = right.retrieval.bm25Rank ?? Number.MAX_SAFE_INTEGER;
    if (leftBm25Rank !== rightBm25Rank) return leftBm25Rank - rightBm25Rank;
    return stableDocumentOrder(left, right);
  });
  return filterWeakHybridTail(ranked).slice(0, topN);
}

function filterWeakHybridTail(
  ranked = [],
  {
    maximumVectorGap = 0.2,
    minimumBm25Coverage = 2 / 3,
    minimumStandaloneVectorScore = 0.6,
  } = {}
) {
  const bestVectorScore = ranked.reduce((best, candidate) => {
    const score = candidate.vectorScore ?? candidate.retrieval?.vectorScore;
    return Number.isFinite(score) ? Math.max(best, score) : best;
  }, Number.NEGATIVE_INFINITY);

  return ranked.filter((candidate) => {
    const bm25Coverage = candidate.retrieval?.bm25Coverage ?? 0;
    if (bm25Coverage >= minimumBm25Coverage) return true;
    const vectorScore =
      candidate.vectorScore ?? candidate.retrieval?.vectorScore ?? null;
    return (
      Number.isFinite(vectorScore) &&
      vectorScore >= minimumStandaloneVectorScore &&
      Number.isFinite(bestVectorScore) &&
      bestVectorScore - vectorScore <= maximumVectorGap
    );
  });
}

module.exports = {
  tokenize,
  rankByBm25,
  fuseGeminiAndBm25,
  filterWeakHybridTail,
};
