const test = require("node:test");
const assert = require("node:assert/strict");
const { cosine, pageRank, summarize } = require("../../scripts/schatImageDescriptionCompare");

test("설명과 가장 가까운 본문 문단의 쪽 순위를 센다", () => {
  const chunks = [
    { page: 3, embedding: [1, 0] },
    { page: 7, embedding: [0.6, 0.8] },
    { page: 9, embedding: [0, 1] },
  ];
  assert.equal(cosine([1, 0], [1, 0]), 1);
  assert.equal(pageRank([0, 1], chunks, 9), 1);
  assert.equal(pageRank([0, 1], chunks, 7), 2);
  assert.equal(pageRank([0, 1], chunks, 99), null);
});

test("요약은 실패·Hit@k·시간·토큰을 센다", () => {
  const summary = summarize([
    { description: "설명", rank: 1, ms: 100, usage: { prompt_tokens: 10, completion_tokens: 2 } },
    { description: "설명2", rank: 4, ms: 300, usage: { prompt_tokens: 10, completion_tokens: 3 } },
    { description: "", rank: null, ms: 50 },
    { error: "x", rank: null },
  ]);
  assert.equal(summary.hit1, "1/4");
  assert.equal(summary.hit5, "2/4");
  assert.equal(summary.empty, 1);
  assert.equal(summary.errors, 1);
  assert.equal(summary.promptTokens, 20);
});
