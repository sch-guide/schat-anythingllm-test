const test = require("node:test");
const assert = require("node:assert/strict");

const { runSchatCompletion } = require("../../../utils/schatSafety/chat");

function imageSource({ id, key, page, section }) {
  return {
    id,
    documentId: "doc-1",
    title: "병원지침.pdf",
    page,
    section,
    text: `${section} 이미지 설명`,
    content_type: "image_description",
    image_key: key,
  };
}

function connectorFor(sourceIds) {
  return {
    async getChatCompletion() {
      return {
        textResponse: JSON.stringify({
          statements: [
            {
              text: "등록된 지침의 답변입니다.",
              supporting_source_unit_ids: sourceIds,
            },
          ],
        }),
        metrics: {},
      };
    },
  };
}

test("검색된 이미지 설명은 답변이 텍스트 근거만 인용해도 관련 이미지로 남는다", async () => {
  const firstKey = "a".repeat(64);
  const secondKey = "b".repeat(64);
  const result = await runSchatCompletion({
    safetyGateEnabled: false,
    question: "NRS 평가",
    sources: [
      {
        id: "text-1",
        documentId: "doc-1",
        title: "병원지침.pdf",
        page: 99,
        section: "통증 사정",
        text: "등록된 지침의 답변입니다.",
      },
      imageSource({ id: "image-1", key: firstKey, page: 100, section: "NRS" }),
      imageSource({ id: "image-2", key: secondKey, page: 101, section: "통증 평가" }),
    ],
    LLMConnector: connectorFor(["su001"]),
  });

  assert.deepEqual(
    result.relatedImages.map((image) => image.imageKey),
    [firstKey, secondKey]
  );
});

test("본문 근거와 별도로 전달된 이미지 후보는 출처를 늘리지 않고 관련 이미지에만 남는다", async () => {
  const imageKey = "e".repeat(64);
  const result = await runSchatCompletion({
    safetyGateEnabled: false,
    question: "NRS",
    sources: [
      {
        id: "text-1",
        documentId: "doc-1",
        title: "병원지침.pdf",
        page: 99,
        section: "통증 사정",
        text: "NRS 통증 사정에 관한 등록 지침입니다.",
      },
    ],
    relatedImageSources: [
      imageSource({ id: "image-nrs", key: imageKey, page: 100, section: "NRS" }),
    ],
    LLMConnector: connectorFor(["su001"]),
  });

  assert.equal(result.sources.length, 1);
  assert.deepEqual(
    result.relatedImages.map((image) => image.imageKey),
    [imageKey]
  );
});

test("Gemini가 직접 사용한 이미지를 먼저 두고 중복 제거 후 세 장으로 제한한다", async () => {
  const keys = ["a", "b", "c", "d"].map((value) => value.repeat(64));
  const result = await runSchatCompletion({
    safetyGateEnabled: false,
    question: "통증 평가 이미지",
    sources: [
      imageSource({ id: "image-1", key: keys[0], page: 100, section: "첫 이미지" }),
      imageSource({ id: "image-2", key: keys[1], page: 101, section: "둘째 이미지" }),
      imageSource({ id: "image-3", key: keys[2], page: 102, section: "직접 사용" }),
      imageSource({ id: "image-4", key: keys[0], page: 103, section: "중복 이미지" }),
      imageSource({ id: "image-5", key: keys[3], page: 104, section: "넷째 이미지" }),
    ],
    LLMConnector: connectorFor(["su003"]),
  });

  assert.deepEqual(
    result.relatedImages.map((image) => image.imageKey),
    [keys[2], keys[0], keys[1]]
  );
});

test("절차 답변도 검색된 이미지 설명을 Gemini의 텍스트 인용과 별개로 유지한다", async () => {
  const keys = ["a", "b"].map((value) => value.repeat(64));
  const result = await runSchatCompletion({
    safetyGateEnabled: false,
    question: "NRS 평가 절차",
    sources: [
      {
        id: "text-1",
        documentId: "doc-1",
        title: "병원지침.pdf",
        page: 99,
        section: "통증 사정",
        text: "등록된 지침의 절차입니다.",
      },
      imageSource({ id: "image-1", key: keys[0], page: 100, section: "NRS 화면" }),
      imageSource({ id: "image-2", key: keys[1], page: 101, section: "평가 화면" }),
    ],
    LLMConnector: {
      async getChatCompletion() {
        return {
          textResponse: JSON.stringify({
            summary_text: "등록된 지침의 절차입니다.",
            summary_source_ids: ["su001"],
            items: [
              {
                section_title: "통증 사정",
                text: "등록된 지침의 절차입니다.",
                source_ids: ["su001"],
              },
            ],
          }),
          metrics: {},
        };
      },
    },
  });

  assert.deepEqual(
    result.relatedImages.map((image) => image.imageKey),
    keys
  );
});
