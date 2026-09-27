const test = require("node:test");
const assert = require("node:assert/strict");

const {
  runSafetyGatedCompletion,
} = require("../../../utils/schatSafety/chat");
const {
  finalizeSafetyDecision,
} = require("../../../utils/schatSafety/finalize");
const {
  buildGeminiChatRequest,
} = require("../../../utils/AiProviders/gemini");

const sources = [
  {
    id: "chunk-1",
    documentId: "doc-1",
    title: "수혈간호지침.pdf",
    page: 7,
    section: "수혈 시행 전 확인사항",
    text: "수혈 전 환자와 혈액제제를 반드시 확인한다.",
  },
];

function prepared(overrides = {}) {
  return {
    contract_id: "c1",
    generation_prompt: "structured prompt",
    structured_output_schema: {
      type: "object",
      required: ["statements"],
    },
    source_units: [{ source_unit_id: "su001" }],
    fallback: { text: "원문 답변", sources: [] },
    ...overrides,
  };
}

test("Python JSON schema is sent to Gemini structured output", async () => {
  const schema = prepared().structured_output_schema;
  let receivedOptions;
  const result = await runSafetyGatedCompletion({
    question: "질문",
    sources,
    LLMConnector: {
      getChatCompletion: async (_messages, options) => {
        receivedOptions = options;
        return {
          textResponse: JSON.stringify({
            statements: [
              { text: "후보", supporting_source_unit_ids: ["su001"] },
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
        display_output: { kind: "candidate", text: "검증 답변", sources: [] },
      }),
    },
  });

  assert.deepEqual(receivedOptions.responseSchema, schema);
  assert.equal(result.text, "검증 답변");
});

test("Gemini request uses strict JSON schema response format", () => {
  const schema = prepared().structured_output_schema;
  const request = buildGeminiChatRequest({
    model: "gemini-3.8-flash",
    messages: [],
    temperature: 0,
    responseSchema: schema,
  });

  assert.deepEqual(request.response_format, {
    type: "json_schema",
    json_schema: {
      name: "schat_controlled_answer",
      strict: true,
      schema,
    },
  });
});

test("invalid JSON and missing statement fields fail closed without retry", async () => {
  for (const [textResponse, errorCode] of [
    ["```json\n{bad}\n```", "candidate_json"],
    ['{"statements":[{}]}', "candidate_schema"],
    [
      '{"statements":[{"text":"후보","supporting_source_unit_ids":["su001"],"extra":true}]}',
      "candidate_schema",
    ],
  ]) {
    let validationCalls = 0;
    const result = await runSafetyGatedCompletion({
      question: "질문",
      sources,
      LLMConnector: {
        getChatCompletion: async () => ({ textResponse, metrics: {} }),
      },
      safetyClient: {
        prepare: async () => prepared(),
        validate: async () => {
          validationCalls += 1;
        },
      },
    });
    assert.equal(result.text, "원문 답변");
    assert.equal(result.safety.errorCode, errorCode);
    assert.equal(result.safety.retryCount, 0);
    assert.equal(validationCalls, 0);
  }
});

test("unknown SourceUnit id is rejected by Python result and falls back", async () => {
  const result = await runSafetyGatedCompletion({
    question: "질문",
    sources,
    LLMConnector: {
      getChatCompletion: async () => ({
        textResponse: JSON.stringify({
          statements: [
            { text: "후보", supporting_source_unit_ids: ["su999"] },
          ],
        }),
        metrics: {},
      }),
    },
    safetyClient: {
      prepare: async () => prepared(),
      validate: async () => ({
        decision: "FAIL",
        retry_count: 0,
        error_code: "unknown_source_unit",
        display_output: {
          kind: "extractive_fallback",
          text: "원문 답변",
          sources: [],
        },
      }),
    },
  });
  assert.equal(result.text, "원문 답변");
  assert.equal(result.safety.errorCode, "unknown_source_unit");
});

test("broken filename is cleaned and Unknown section is omitted", async () => {
  let retrieved;
  await runSafetyGatedCompletion({
    question: "질문",
    sources: [
      {
        ...sources[0],
        title: "SCHAT_���.txt",
        section: "",
        description: "Unknown",
      },
    ],
    LLMConnector: {
      getChatCompletion: async () => ({
        textResponse: JSON.stringify({
          statements: [
            { text: "후보", supporting_source_unit_ids: ["su001"] },
          ],
        }),
        metrics: {},
      }),
    },
    safetyClient: {
      prepare: async (payload) => {
        retrieved = payload.retrieved_chunks[0];
        return prepared();
      },
      validate: async () => ({
        decision: "FAIL",
        retry_count: 0,
        display_output: {
          kind: "extractive_fallback",
          text: "원문 답변",
          sources: [],
        },
      }),
    },
  });
  assert.equal(retrieved.document_name, "SCHAT_.txt");
  assert.equal(retrieved.section, "");

  const finalized = finalizeSafetyDecision({
    prepared: {
      fallback: {
        text: "원문 답변",
        sources: [
          { document_name: "SCHAT_���.txt", page: null, section: "Unknown" },
        ],
      },
    },
    validation: { decision: "FAIL" },
  });
  assert.equal(finalized.sources[0].title, "SCHAT_.txt");
  assert.equal(finalized.sources[0].section, "");
  assert.equal("chunk_id" in finalized.sources[0], false);
  assert.equal("document_id" in finalized.sources[0], false);
});
