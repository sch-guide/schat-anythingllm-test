const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildBodySearchQueries,
  mergeBodySearchResults,
  runExpandedBodySearch,
} = require("../../../utils/chats/expandedBodySearch");

test("평가 도구 질문은 특정 약어 하드코딩 없이 최대 세 개의 로컬 변형을 만든다", () => {
  assert.deepEqual(buildBodySearchQueries("NRS"), [
    "NRS",
    "NRS 평가 도구",
    "NRS 평가 방법",
    "NRS 사정",
  ]);
  assert.deepEqual(buildBodySearchQueries("FPRS"), [
    "FPRS",
    "FPRS 평가 도구",
    "FPRS 평가 방법",
    "FPRS 사정",
  ]);
  assert.deepEqual(buildBodySearchQueries("NRS 통증척도는 어떻게 평가해?"), [
    "NRS 통증척도는 어떻게 평가해?",
    "nrs 통증척도 평가 방법",
    "nrs 통증척도 사정",
    "nrs 통증척도 점수 기준",
  ]);
});

test("절차와 관리 질문은 주제를 유지한 일반 의료 검색 변형을 만든다", () => {
  assert.deepEqual(buildBodySearchQueries("수혈 절차 알려줘"), [
    "수혈 절차 알려줘",
    "수혈 시행 절차",
    "수혈 준비 확인",
    "수혈 단계",
  ]);
  assert.deepEqual(buildBodySearchQueries("중심정맥관 관리 방법 알려줘"), [
    "중심정맥관 관리 방법 알려줘",
    "중심정맥관 관리 절차",
    "중심정맥관 관리 방법",
    "중심정맥관 관리 주의사항",
  ]);
});

test("의료 검색 의도를 확인할 수 없는 질문은 확장하지 않는다", () => {
  assert.deepEqual(buildBodySearchQueries("오늘 날씨 어때?"), [
    "오늘 날씨 어때?",
  ]);
});

test("여러 검색 결과는 SourceUnit 중복을 제거하고 일반 질문 상한 네 개를 지킨다", () => {
  const source = (id, text, score) => ({
    id,
    chunk_id: id,
    document_id: "document-1",
    text,
    score,
  });
  const merged = mergeBodySearchResults(
    [
      {
        sources: [source("a", "A", 0.9), source("b", "B", 0.8)],
        relatedImageSources: [{ image_key: "original-image" }],
        message: false,
      },
      {
        sources: [source("b", "B duplicate", 0.95), source("c", "C", 0.85)],
        relatedImageSources: [{ image_key: "variation-image" }],
        message: false,
      },
      {
        sources: [source("d", "D", 0.8), source("e", "E", 0.7)],
        relatedImageSources: [],
        message: false,
      },
    ],
    { limit: 4 }
  );

  assert.equal(merged.sources.length, 4);
  assert.equal(new Set(merged.sources.map((item) => item.id)).size, 4);
  assert.equal(merged.sources[0].id, "b");
  assert.deepEqual(merged.relatedImageSources, [
    { image_key: "original-image" },
  ]);
  assert.deepEqual(
    merged.contextTexts,
    merged.sources.map((item) => item.text)
  );
});

test("본문 변형 검색은 원문 검색에서만 관련 이미지를 요청한다", async () => {
  const calls = [];
  const result = await runExpandedBodySearch({
    originalQuestion: "NRS",
    expandedBodyQuery: "NRS",
    topN: 4,
    search: async ({ input, includeRelatedImages, relatedImageQueryText }) => {
      calls.push({ input, includeRelatedImages, relatedImageQueryText });
      return {
        sources: [
          {
            id: input,
            chunk_id: input,
            document_id: "document-1",
            text: `${input} 근거`,
          },
        ],
        relatedImageSources: includeRelatedImages
          ? [{ image_key: "nrs-image" }]
          : [],
        message: false,
      };
    },
  });

  assert.equal(calls.length, 4);
  assert.deepEqual(calls[0], {
    input: "NRS",
    includeRelatedImages: true,
    relatedImageQueryText: "NRS",
  });
  assert.ok(
    calls.slice(1).every(
      (call) =>
        call.includeRelatedImages === false &&
        call.relatedImageQueryText === undefined
    )
  );
  assert.deepEqual(result.relatedImageSources, [{ image_key: "nrs-image" }]);
});

