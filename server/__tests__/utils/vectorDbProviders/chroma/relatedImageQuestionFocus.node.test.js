const test = require("node:test");
const assert = require("node:assert/strict");

const {
  rankByBm25,
  fuseGeminiAndBm25,
} = require("../../../../utils/vectorDbProviders/chroma/schatBm25.js");

const candidates = [
  {
    id: "nrs-image",
    text: "NRS가 선택된 0점부터 10점까지의 통증 점수 평가 화면",
    metadata: { content_type: "image_description" },
    vectorScore: 0.95,
  },
  {
    id: "fprs-image",
    text: "FPRS가 선택된 얼굴 표정 통증 점수 평가 화면",
    metadata: { content_type: "image_description" },
    vectorScore: 0.94,
  },
  {
    id: "logo-image",
    text: "병원 간호부 로고 장식 이미지",
    metadata: { content_type: "image_description" },
    vectorScore: 0.1,
  },
];

for (const scenario of [
  { question: "NRS", expected: ["nrs-image"] },
  {
    question: "NRS 통증척도는 어떻게 평가해?",
    expected: ["nrs-image"],
  },
  { question: "FPRS", expected: ["fprs-image"] },
  {
    question: "통증 점수 설명",
    expected: ["nrs-image", "fprs-image"],
  },
  {
    question: "통증 점수 알려줘",
    expected: ["nrs-image", "fprs-image"],
  },
]) {
  test(`related image focus: ${scenario.question}`, () => {
    const bm25Ranked = rankByBm25(scenario.question, candidates);
    const result = fuseGeminiAndBm25(candidates, bm25Ranked, {
      topN: 3,
      queryText: scenario.question,
      maxImageResults: 3,
    });

    assert.deepEqual(
      result.map(({ id }) => id),
      scenario.expected
    );
    assert.equal(result.some(({ id }) => id === "logo-image"), false);
  });
}
