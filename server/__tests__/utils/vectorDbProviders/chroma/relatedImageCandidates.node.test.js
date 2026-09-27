const test = require("node:test");
const assert = require("node:assert/strict");

const {
  Chroma,
} = require("../../../../utils/vectorDbProviders/chroma/index.js");

test("본문 top-N 밖의 질문 관련 이미지 설명을 별도 이미지 후보로 보존한다", async () => {
  const imageKey = "a".repeat(64);
  const collection = {
    async query() {
      return {
        ids: [["text-1", "text-2"]],
        documents: [["NRS 통증 사정 본문", "통증 평가 기록 본문"]],
        metadatas: [[
          { title: "병원지침.pdf", page: 99 },
          { title: "병원지침.pdf", page: 101 },
        ]],
        distances: [[0.05, 0.1]],
      };
    },
    async get() {
      return {
        ids: ["text-1", "text-2", "image-nrs"],
        documents: [
          "NRS 통증 사정 본문",
          "통증 평가 기록 본문",
          "NRS 도구와 0점부터 10점까지의 통증 점수를 보여주는 평가 화면",
        ],
        metadatas: [
          { title: "병원지침.pdf", page: 99 },
          { title: "병원지침.pdf", page: 101 },
          {
            title: "병원지침.pdf",
            page: 100,
            content_type: "image_description",
            image_key: imageKey,
          },
        ],
      };
    },
  };
  const client = {
    async getCollection() {
      return collection;
    },
  };

  const result = await new Chroma().similarityResponse({
    client,
    namespace: "schat-test",
    queryVector: [0.1, 0.2],
    queryText: "NRS",
    similarityThreshold: 0.25,
    topN: 2,
  });

  assert.deepEqual(result.contextTexts, [
    "NRS 통증 사정 본문",
    "통증 평가 기록 본문",
  ]);
  assert.deepEqual(
    result.relatedImageSources.map((source) => source.image_key),
    [imageKey]
  );
  assert.equal(
    result.relatedImageSources[0].text,
    "NRS 도구와 0점부터 10점까지의 통증 점수를 보여주는 평가 화면"
  );
});

test("검색 응답 계층이 별도 이미지 후보를 채팅 경로까지 보존한다", async () => {
  const imageKey = "b".repeat(64);
  const chroma = new Chroma();
  chroma.connect = async () => ({ client: {} });
  chroma.namespaceExists = async () => true;
  chroma.similarityResponse = async () => ({
    contextTexts: ["NRS 통증 사정 본문"],
    sourceDocuments: [
      { id: "text-1", title: "병원지침.pdf", page: 99 },
    ],
    scores: [0.9],
    relatedImageSources: [
      {
        id: "image-nrs",
        title: "병원지침.pdf",
        page: 100,
        content_type: "image_description",
        image_key: imageKey,
        text: "NRS 통증 평가 화면",
      },
    ],
  });

  const result = await chroma.performSimilaritySearch({
    namespace: "schat-test",
    input: "NRS",
    LLMConnector: {
      async embedTextInput() {
        return [0.1, 0.2];
      },
    },
    similarityThreshold: 0.25,
    topN: 4,
  });

  assert.deepEqual(
    result.relatedImageSources.map((source) => source.image_key),
    [imageKey]
  );
  assert.equal(result.relatedImageSources[0].text, "NRS 통증 평가 화면");
});
