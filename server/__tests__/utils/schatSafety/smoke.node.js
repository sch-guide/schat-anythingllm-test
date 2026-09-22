const assert = require("node:assert/strict");
const fs = require("node:fs");

const { runSafetyGatedCompletion } = require("../../../utils/schatSafety/chat");
const { finalizeSafetyDecision } = require("../../../utils/schatSafety/finalize");
const {
  attachVectorIdentity,
} = require("../../../utils/vectorDbProviders/chroma/sourceIdentity");

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

async function main() {
  const pass = await runSafetyGatedCompletion({
    question: "무엇을 확인하나요?",
    sources,
    LLMConnector: {
      getChatCompletion: async () => ({
        textResponse: JSON.stringify({
          statements: [
            { text: "검증 전 후보", supporting_source_unit_ids: ["su001"] },
          ],
        }),
        metrics: {},
      }),
    },
    safetyClient: {
      prepare: async () => ({
        contract_id: "contract-1",
        generation_prompt: "prompt",
        source_units: [{ source_unit_id: "su001" }],
        fallback: { text: "원문 안전 답변", sources: [] },
      }),
      validate: async () => ({
        decision: "PASS",
        retry_count: 0,
        display_output: { kind: "candidate", text: "검증된 답변", sources: [] },
      }),
    },
  });
  assert.equal(pass.text, "검증된 답변");
  assert.equal(pass.text.includes("검증 전 후보"), false);

  let generationCalls = 0;
  const prepareFailure = await runSafetyGatedCompletion({
    question: "질문",
    sources,
    LLMConnector: {
      getChatCompletion: async () => {
        generationCalls += 1;
        return {};
      },
    },
    safetyClient: {
      prepare: async () => {
        throw new Error("offline");
      },
    },
  });
  assert.equal(generationCalls, 0);
  assert.match(prepareFailure.text, /답변하지 않습니다/);

  let validationCalls = 0;
  const validationFailure = await runSafetyGatedCompletion({
    question: "질문",
    sources,
    LLMConnector: {
      getChatCompletion: async () => ({
        textResponse: JSON.stringify({
          statements: [
            {
              text: "candidate",
              supporting_source_unit_ids: ["su001"],
            },
          ],
        }),
        metrics: {},
      }),
    },
    safetyClient: {
      prepare: async () => ({
        contract_id: "contract-1",
        generation_prompt: "prompt",
        source_units: [{ source_unit_id: "su001" }],
        fallback: { text: "원문 안전 답변", sources: [] },
      }),
      validate: async () => {
        validationCalls += 1;
        throw Object.assign(new Error("timeout"), {
          code: "safety_evaluator_timeout",
        });
      },
    },
  });
  assert.equal(validationCalls, 1);
  assert.equal(validationFailure.text, "원문 안전 답변");
  assert.equal(validationFailure.safety.usedFallback, true);
  assert.equal(typeof validationFailure.safety.usedFallback, "boolean");
  assert.equal(
    JSON.stringify(validationFailure.safety).includes("원문 안전 답변"),
    false
  );
  assert.equal(validationFailure.safety.retryCount, 0);

  const citation = finalizeSafetyDecision({
    prepared: {
      fallback: {
        text: "원문 안전 답변",
        sources: [
          {
            document_name: "수혈간호지침.pdf",
            page: 7,
            section: "수혈 시행 전 확인사항",
          },
        ],
      },
    },
    validation: { decision: "FAIL", error_code: "number_changed" },
  });
  assert.equal(
    citation.sources[0].title,
    "수혈간호지침.pdf · p.7 · 수혈 시행 전 확인사항"
  );
  assert.equal("chunk_id" in citation.sources[0], false);

  const identified = attachVectorIdentity(
    [{ id: "vector-1", title: "지침.pdf" }],
    [{ vectorId: "vector-1", docId: "document-1" }]
  );
  assert.equal(identified[0].chunk_id, "vector-1");
  assert.equal(identified[0].document_id, "document-1");

  const streamSource = fs.readFileSync(
    "/app/server/utils/chats/stream.js",
    "utf8"
  );
  const gatePosition = streamSource.indexOf("SCHAT_SAFETY_ENABLED");
  const streamingPosition = streamSource.indexOf("streamGetChatCompletion", gatePosition);
  assert.ok(gatePosition >= 0);
  assert.ok(streamingPosition > gatePosition);
  assert.match(streamSource.slice(gatePosition, streamingPosition), /runSafetyGatedCompletion/);

  console.log("SCHAT safety smoke tests: PASS");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
