const test = require("node:test");
const assert = require("node:assert/strict");
const {
  runSafetyGatedCompletion,
} = require("../../../utils/schatSafety/chat");

const sources = [
  {
    id: "chunk-1",
    documentId: "doc-1",
    title: "approved-guide.pdf",
    page: 1,
    section: "approved section",
    text: "approved source text",
  },
];

function prepared() {
  return {
    contract_id: "c1",
    generation_prompt: "structured grounded prompt",
    structured_output_schema: { type: "object" },
    source_units: [{ source_unit_id: "su001" }],
    fallback: { text: "safe source fallback", sources: [] },
  };
}

test("이미지 후보는 Python PASS 뒤에만 최종 답변으로 반환된다", async () => {
  let sentMessages;
  let generateCalls = 0;
  const image = {
    mime: "image/png",
    contentString: `data:image/png;base64,${Buffer.from("image").toString("base64")}`,
  };
  const result = await runSafetyGatedCompletion({
    question: "이 화면 관련 지침은?",
    sources,
    attachments: [image],
    LLMConnector: {
      getChatCompletion: async (messages) => {
        generateCalls += 1;
        sentMessages = messages;
        return {
          textResponse: JSON.stringify({
            statements: [
              { text: "hidden candidate", supporting_source_unit_ids: ["su001"] },
            ],
          }),
          metrics: {},
        };
      },
    },
    safetyClient: {
      prepare: async () => prepared(),
      validate: async () => ({
        decision: "PASS",
        retry_count: 0,
        display_output: {
          kind: "candidate",
          text: "validated answer",
          sources: [],
        },
      }),
    },
  });

  assert.equal(generateCalls, 1);
  assert.equal(sentMessages[0].content[1].type, "image_url");
  assert.equal(result.text, "validated answer");
  assert.equal(result.text.includes("hidden candidate"), false);
});

test("이미지 임상 사실이 SourceUnit으로 지지되지 않으면 원문 답변으로 대체한다", async () => {
  let generateCalls = 0;
  let validateCalls = 0;
  const result = await runSafetyGatedCompletion({
    question: "이 화면 관련 지침은?",
    sources,
    attachments: [
      {
        mime: "image/jpeg",
        contentString: `data:image/jpeg;base64,${Buffer.from("image").toString("base64")}`,
      },
    ],
    LLMConnector: {
      getChatCompletion: async () => {
        generateCalls += 1;
        return {
          textResponse: JSON.stringify({
            statements: [
              {
                text: "image-only clinical claim",
                supporting_source_unit_ids: ["su001"],
              },
            ],
          }),
          metrics: {},
        };
      },
    },
    safetyClient: {
      prepare: async () => prepared(),
      validate: async () => {
        validateCalls += 1;
        return {
          decision: "FAIL",
          retry_count: 0,
          error_code: "unsupported_claim",
          display_output: {
            kind: "extractive_fallback",
            text: "safe source fallback",
            sources: [],
          },
        };
      },
    },
  });

  assert.equal(generateCalls, 1);
  assert.equal(validateCalls, 1);
  assert.equal(result.text, "safe source fallback");
  assert.equal(result.safety.usedFallback, true);
  assert.equal(result.safety.retryCount, 0);
});

test("잘못된 이미지는 Gemini 호출 없이 안전 답변으로 대체한다", async () => {
  let generateCalls = 0;
  const result = await runSafetyGatedCompletion({
    question: "질문",
    sources,
    attachments: [
      {
        mime: "image/gif",
        contentString: "data:image/gif;base64,R0lGODlhAQABAIAAAAUEBA==",
      },
    ],
    LLMConnector: {
      getChatCompletion: async () => {
        generateCalls += 1;
      },
    },
    safetyClient: {
      prepare: async () => prepared(),
      validate: async () => assert.fail("validation must not run"),
    },
  });

  assert.equal(generateCalls, 0);
  assert.equal(result.text, "safe source fallback");
  assert.equal(result.safety.errorCode, "image_type_unsupported");
  assert.equal(result.safety.retryCount, 0);
});
