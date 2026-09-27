const assert = require("node:assert/strict");
const { createSafetyClient } = require("../../../utils/schatSafety/client");

async function main() {
  const client = createSafetyClient();
  const prepared = await client.prepare({
    schema_version: "1",
    request_id: "cross-service-1",
    question: "무엇을 확인하나요?",
    retrieved_chunks: [
      {
        chunk_id: "chunk-1",
        document_id: "document-1",
        document_name: "test.pdf",
        page: 1,
        section: "절차",
        rank: 1,
        text: "환자 정보를 확인한다.",
      },
    ],
  });
  const validated = await client.validate({
    schema_version: "1",
    prepared,
    candidate: {
      statements: [
        {
          text: "환자 정보를 확인한다.",
          supporting_source_unit_ids: ["su001"],
        },
      ],
    },
  });

  assert.equal(validated.decision, "PASS");
  assert.equal(validated.retry_count, 0);
  console.log("SCHAT cross-service safety test: PASS");
}

main().catch((error) => {
  console.error(error?.code || "cross_service_failed");
  process.exitCode = 1;
});
