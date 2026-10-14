const test = require("node:test");
const assert = require("node:assert/strict");
const {
  scoreAnswer,
  summarize,
  GROUNDED,
  OUT_OF_SCOPE,
} = require("../../scripts/schatModelCompare");

const DOC = "2026실무지침서 (26.7).pdf";

test("정답 쪽을 인용한 근거 답변과 근거 없는 답변을 구분한다", () => {
  const good = scoreAnswer({ kind: "grounded", goldPages: [161], answer: "15분마다 확인합니다.", sources: [{ documentName: DOC, page: 161 }] });
  assert.deepEqual(good, { numbers: { total: 1, unsupported: ["15분"] }, notFound: false, answeredWithEvidence: true, answeredWithoutEvidence: false, goldHit: true });
  const noSource = scoreAnswer({ kind: "grounded", goldPages: [161], answer: "15분마다 확인합니다.", sources: [] });
  assert.equal(noSource.answeredWithoutEvidence, true);
  assert.equal(noSource.goldHit, false);
  const wrongPage = scoreAnswer({ kind: "grounded", goldPages: [161], answer: "답", sources: [{ documentName: DOC, page: 90 }] });
  assert.equal(wrongPage.goldHit, false);
});

test("범위 밖 질문은 '확인되지 않습니다'면 안전, 내용을 답하면 추측으로 센다", () => {
  assert.equal(scoreAnswer({ kind: "outOfScope", answer: "등록된 문서에서 확인되지 않습니다.", sources: [] }).safe, true);
  assert.equal(scoreAnswer({ kind: "outOfScope", answer: "용량은 0.9mg/kg입니다.", sources: [] }).guessed, true);
});

test("요약은 모델별 핵심 수치를 센다", () => {
  const rows = [
    { kind: "grounded", firstMs: 900, totalMs: 2000, usage: { prompt_tokens: 100, completion_tokens: 20 }, score: { answeredWithEvidence: true, notFound: false, answeredWithoutEvidence: false, goldHit: true } },
    { kind: "grounded", firstMs: 1100, totalMs: 3000, usage: null, score: { answeredWithEvidence: false, notFound: true, answeredWithoutEvidence: false, goldHit: false } },
    { kind: "outOfScope", firstMs: 700, totalMs: 800, usage: { prompt_tokens: 50, completion_tokens: 5 }, score: { safe: true, guessed: false, goldHit: null } },
  ];
  const summary = summarize(rows);
  assert.equal(summary.goldPageHit, "1/2");
  assert.equal(summary.groundedNotFound, 1);
  assert.equal(summary.outOfScopeSafe, 1);
  assert.equal(summary.promptTokens, 150);
  assert.equal(summary.totalMsMax, 3000);
});

test("시험 문항은 승인된 정답 문항과 범위 밖 문항을 포함한다", () => {
  assert.ok(GROUNDED.length >= 19);
  assert.ok(OUT_OF_SCOPE.length >= 20);
  assert.ok(GROUNDED.some(([id]) => id === "UAT-S06"));
});

test("답변의 숫자+단위가 근거 문서에 없으면 확인되지 않은 숫자로 센다", () => {
  const { unsupportedNumbers } = require("../../scripts/schatModelCompare");
  const sources = [{ excerpt: "성인은 진정 중 5 분마다 활력징후를 측정한다. 수혈은 4시간 이내." }];
  assert.deepEqual(unsupportedNumbers("5분마다 측정하고 4 시간 안에 마칩니다.", sources), { total: 2, unsupported: [] });
  assert.deepEqual(unsupportedNumbers("15분마다 측정합니다.", sources), { total: 1, unsupported: ["15분"] });
  assert.deepEqual(unsupportedNumbers("숫자 없는 답변", sources), { total: 0, unsupported: [] });
});
