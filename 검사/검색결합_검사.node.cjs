const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const chromaSource = fs.readFileSync(
  path.join(ROOT, "server/utils/vectorDbProviders/chroma/index.js"),
  "utf8"
);

test("Chroma의 동일 collection 문서를 BM25 보완에 사용한다", () => {
  assert.match(chromaSource, /require\("\.\/schatBm25"\)/);
  assert.match(chromaSource, /collection\.get\(/);
  assert.match(chromaSource, /rankByBm25\(queryText, corpusDocuments\)/);
});

test("Chroma 검색 결과를 Gemini 우선 BM25 보완 순위로 결합한다", () => {
  assert.match(chromaSource, /fuseGeminiAndBm25\(/);
  assert.match(chromaSource, /vectorWeight: 0\.75/);
  assert.match(chromaSource, /bm25Weight: 0\.25/);
});

test("SCHAT Chroma 검색 경로는 MiniLM 재정렬을 호출하지 않는다", () => {
  assert.doesNotMatch(chromaSource, /NativeEmbeddingReranker/);
  assert.doesNotMatch(chromaSource, /rerankedSimilarityResponse/);
});
