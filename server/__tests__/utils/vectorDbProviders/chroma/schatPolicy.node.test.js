const test = require("node:test");
const assert = require("node:assert/strict");

const {
  SCHAT_CHUNK_SIZE,
  SCHAT_CHUNK_OVERLAP,
  SCHAT_CHUNK_POLICY_VERSION,
  isEmployeeSearchDocument,
  searchableChunkMetadata,
} = require("../../../../utils/vectorDbProviders/chroma/schatPolicy");

test("SCHAT uses bounded chunks instead of the embedding model maximum", () => {
  assert.equal(SCHAT_CHUNK_SIZE, 900);
  assert.equal(SCHAT_CHUNK_OVERLAP, 120);
  assert.ok(SCHAT_CHUNK_SIZE < 8192);
  assert.match(SCHAT_CHUNK_POLICY_VERSION, /900-120/);
});

test("evaluation, test, and synthetic documents are excluded from employee search", () => {
  for (const usageScope of ["evaluation", "test", "synthetic"]) {
    assert.equal(isEmployeeSearchDocument({ usage_scope: usageScope }), false);
  }
  assert.equal(isEmployeeSearchDocument({ usage_scope: "employee" }), true);
  assert.equal(isEmployeeSearchDocument({}), true);
});

test("chunk metadata remains separate from the searchable clinical text", () => {
  const result = searchableChunkMetadata({
    title: "진정간호.pdf",
    page: 7,
    section: "대상",
    usage_scope: "employee",
  });
  assert.equal(result.chunkHeaderMeta, null);
  assert.equal(result.metadata.title, "진정간호.pdf");
  assert.equal(result.metadata.page, 7);
  assert.equal(result.metadata.section, "대상");
});
