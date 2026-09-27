const test = require("node:test");
const assert = require("node:assert/strict");

const {
  SCHAT_CHUNK_SIZE,
  SCHAT_CHUNK_OVERLAP,
  SCHAT_CHUNK_POLICY_VERSION,
  explicitSectionFromText,
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

test("원본 section을 우선 보존하고 명시된 제목만 추출한다", () => {
  assert.equal(
    explicitSectionFromText("# 다른 제목\n본문", "수혈 시행 전 확인"),
    "수혈 시행 전 확인"
  );
  assert.equal(
    explicitSectionFromText(
      "간호실무지침 - 238 -\n3. 혈액 제제의 종류\n적혈구 제제",
      ""
    ),
    "혈액 제제의 종류"
  );
  assert.equal(
    explicitSectionFromText("일반 본문 문장입니다.\n다음 문장입니다.", ""),
    ""
  );
});

test("PDF에서 독립된 짧은 항목 제목은 section으로 보존한다", () => {
  assert.equal(
    explicitSectionFromText(
      "혈액제제 종류\n적혈구 제제, 혈소판 제제, 신선동결혈장",
      ""
    ),
    "혈액제제 종류"
  );
});
