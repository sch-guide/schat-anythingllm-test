const test = require("node:test");
const assert = require("node:assert/strict");

const {
  tokenize,
  rankByBm25,
  fuseGeminiAndBm25,
  filterWeakHybridTail,
} = require("../../../../utils/vectorDbProviders/chroma/schatBm25");

test("한글·영문·숫자를 검색 토큰으로 보존한다", () => {
  assert.deepEqual(tokenize("수혈 전 Hb 8.0 g/dL 확인"), [
    "수혈",
    "전",
    "hb",
    "8.0",
    "g",
    "dl",
    "확인",
  ]);
});

test("정확한 병원 용어가 있는 청크를 BM25 상위에 둔다", () => {
  const documents = [
    { id: "a", text: "일반적인 환자 확인 절차", metadata: {} },
    { id: "b", text: "수혈 동의서 작성 시점과 확인 절차", metadata: {} },
    { id: "c", text: "투약 동의서 작성 절차", metadata: {} },
  ];

  const ranked = rankByBm25("수혈 동의서 작성 시점", documents);

  assert.equal(ranked[0].id, "b");
  assert.ok(ranked[0].bm25Score > ranked[1].bm25Score);
});

test("Gemini 순위를 우선하면서 BM25 정확 용어가 중간 순위를 보완한다", () => {
  const vectorRanked = [
    { id: "a", text: "수혈 절차", metadata: {}, vectorScore: 0.95 },
    { id: "b", text: "환자 확인", metadata: {}, vectorScore: 0.9 },
    {
      id: "c",
      text: "수혈 동의서 작성 시점",
      metadata: {},
      vectorScore: 0.82,
    },
  ];
  const bm25Ranked = [
    { id: "c", text: "수혈 동의서 작성 시점", metadata: {}, bm25Score: 4 },
    { id: "a", text: "수혈 절차", metadata: {}, bm25Score: 1 },
  ];

  const fused = fuseGeminiAndBm25(vectorRanked, bm25Ranked, {
    topN: 3,
    vectorWeight: 0.75,
    bm25Weight: 0.25,
  });

  assert.deepEqual(
    fused.map((item) => item.id),
    ["a", "c", "b"]
  );
  assert.equal(fused[0].retrieval.vectorRank, 1);
  assert.equal(fused[1].retrieval.bm25Rank, 1);
});

test("동점이면 기존 문서 순서와 ID 순으로 항상 같은 결과를 낸다", () => {
  const documents = [
    { id: "b", text: "동일 용어", metadata: {}, corpusPosition: 0 },
    { id: "a", text: "동일 용어", metadata: {}, corpusPosition: 0 },
    { id: "c", text: "동일 용어", metadata: {}, corpusPosition: 2 },
  ];

  const first = rankByBm25("동일 용어", documents).map((item) => item.id);
  const second = rankByBm25("동일 용어", documents).map((item) => item.id);

  assert.deepEqual(first, ["a", "b", "c"]);
  assert.deepEqual(second, first);
});

test("질문 단어의 절반 이상이 정확히 일치하면 BM25 보완 근거로 유지한다", () => {
  const ranked = rankByBm25("Hb 수혈 기준", [
    { id: "exact", text: "Hb 수혈 기준 안내", metadata: {} },
    { id: "weak", text: "일반 수혈 절차", metadata: {} },
  ]);

  assert.equal(ranked[0].id, "exact");
  assert.ok(ranked[0].bm25Coverage >= 0.5);
  assert.ok(ranked[1].bm25Coverage < 0.5);
});

test("의미 점수 차이가 크고 정확 단어 일치도도 낮은 꼬리 결과만 제거한다", () => {
  const filtered = filterWeakHybridTail([
    {
      id: "best",
      vectorScore: 0.91,
      retrieval: { vectorRank: 1, bm25Rank: 1, bm25Coverage: 0.75 },
    },
    {
      id: "semantic-near",
      vectorScore: 0.81,
      retrieval: { vectorRank: 2, bm25Rank: null, bm25Coverage: 0 },
    },
    {
      id: "exact-abbreviation",
      vectorScore: null,
      retrieval: { vectorRank: null, bm25Rank: 2, bm25Coverage: 1 },
    },
    {
      id: "irrelevant-tail",
      vectorScore: 0.48,
      retrieval: { vectorRank: 3, bm25Rank: 3, bm25Coverage: 0.25 },
    },
  ]);

  assert.deepEqual(
    filtered.map((item) => item.id),
    ["best", "semantic-near", "exact-abbreviation"]
  );
});

test("weak vector-only first result is not forced into employee context", () => {
  const filtered = filterWeakHybridTail([
    {
      id: "weak-semantic",
      vectorScore: 0.55,
      retrieval: { vectorRank: 1, bm25Rank: null, bm25Coverage: 0 },
    },
  ]);
  assert.deepEqual(filtered, []);
});

test("strong semantic or exact keyword evidence is preserved", () => {
  const filtered = filterWeakHybridTail([
    {
      id: "strong-semantic",
      vectorScore: 0.72,
      retrieval: { vectorRank: 1, bm25Rank: null, bm25Coverage: 0 },
    },
    {
      id: "exact-keyword",
      vectorScore: 0.42,
      retrieval: { vectorRank: 2, bm25Rank: 1, bm25Coverage: 1 },
    },
  ]);
  assert.deepEqual(
    filtered.map((item) => item.id),
    ["strong-semantic", "exact-keyword"]
  );
});

test("one generic word out of a two-word question does not rescue weak evidence", () => {
  const filtered = filterWeakHybridTail([
    {
      id: "generic-purpose-only",
      vectorScore: 0.55,
      retrieval: { vectorRank: 1, bm25Rank: 1, bm25Coverage: 0.5 },
    },
  ]);
  assert.deepEqual(filtered, []);
});
