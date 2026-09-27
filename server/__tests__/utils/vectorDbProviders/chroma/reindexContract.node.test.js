const test = require("node:test");
const assert = require("node:assert/strict");

const {
  assertApprovedReindexScope,
  buildWorkspaceRepairPlan,
  buildReindexCollectionNames,
  sanitizeChromaMetadata,
  selectPreferredCompleteDocumentGroup,
  summarizeReindexMetadata,
} = require("../../../../utils/vectorDbProviders/chroma/reindexContract");

test("완전한 최신 PDF 그룹 중 이미지 설명이 있는 그룹을 정본으로 선택한다", () => {
  const records = [
    ...[1, 2, 3].map((page) => ({
      document_id: "older",
      title: "guide.pdf",
      page,
      docpath: `custom-documents/older-${page}.json`,
      mtimeMs: 10,
      pdf_images: [],
    })),
    ...[1, 2, 3].map((page) => ({
      document_id: "newer",
      title: "guide.pdf",
      page,
      docpath: `custom-documents/newer-${page}.json`,
      mtimeMs: 20,
      pdf_images:
        page === 2
          ? [{ image_key: "a".repeat(64), description: "절차도" }]
          : [],
    })),
  ];

  const selected = selectPreferredCompleteDocumentGroup(records, {
    title: "guide.pdf",
    expectedPages: 3,
    requiredPages: [2, 3],
  });

  assert.equal(selected.documentId, "newer");
  assert.deepEqual(
    selected.records.map(({ page }) => page),
    [1, 2, 3]
  );
  assert.equal(selected.imageDescriptionCount, 1);
});

test("페이지 중복 또는 누락이 있는 PDF 그룹은 정본으로 선택하지 않는다", () => {
  const records = [
    { document_id: "broken", title: "guide.pdf", page: 1 },
    { document_id: "broken", title: "guide.pdf", page: 1 },
    { document_id: "broken", title: "guide.pdf", page: 3 },
  ];

  assert.throws(
    () =>
      selectPreferredCompleteDocumentGroup(records, {
        title: "guide.pdf",
        expectedPages: 3,
      }),
    /complete source document group/i
  );
});

test("workspace 복구 계획은 기존 다른 문서를 보존하고 정본의 빠진 페이지만 추가한다", () => {
  const localRecords = [
    ...[1, 2, 3].map((page) => ({
      document_id: "canonical",
      title: "guide.pdf",
      page,
      docpath: `custom-documents/canonical-${page}.json`,
      mtimeMs: 20,
      pdf_images: [],
    })),
    ...[1, 2, 3].map((page) => ({
      document_id: "duplicate",
      title: "guide.pdf",
      page,
      docpath: `custom-documents/duplicate-${page}.json`,
      mtimeMs: 10,
      pdf_images: [],
    })),
  ];
  const workspaceRecords = [
    { document_id: "other", title: "other.pdf", page: 1, docpath: "other-1" },
    { document_id: "other", title: "other.pdf", page: 2, docpath: "other-2" },
    {
      document_id: "canonical",
      title: "guide.pdf",
      page: 1,
      docpath: "custom-documents/canonical-1.json",
    },
    {
      document_id: "duplicate",
      title: "guide.pdf",
      page: 1,
      docpath: "custom-documents/duplicate-1.json",
    },
  ];

  const plan = buildWorkspaceRepairPlan(localRecords, workspaceRecords, {
    title: "guide.pdf",
    expectedPages: 3,
  });

  assert.equal(plan.preservedRecords.length, 2);
  assert.equal(plan.canonicalExistingRecords.length, 1);
  assert.equal(plan.duplicateTargetRecords.length, 1);
  assert.deepEqual(
    plan.missingCanonicalRecords.map(({ page }) => page),
    [2, 3]
  );
  assert.equal(plan.expectedFinalDocuments, 5);
});

test("승인된 한 논리 문서의 100개 페이지만 재색인할 수 있다", () => {
  const records = Array.from({ length: 100 }, (_, index) => ({
    document_id: "approved-document",
    page: index + 1,
  }));

  const result = assertApprovedReindexScope(records, {
    expectedDocuments: 100,
    expectedLogicalDocuments: 1,
  });

  assert.deepEqual(result, {
    recordCount: 100,
    logicalDocumentCount: 1,
  });
});

test("승인 범위를 벗어난 문서나 페이지 수는 교체 전에 거부한다", () => {
  assert.throws(
    () =>
      assertApprovedReindexScope(
        [
          { document_id: "approved-document", page: 1 },
          { document_id: "other-document", page: 2 },
        ],
        { expectedDocuments: 100, expectedLogicalDocuments: 1 }
      ),
    /approved reindex scope/i
  );
});

test("페이지가 중복되어 한 페이지가 빠진 100건도 승인 범위로 보지 않는다", () => {
  const records = Array.from({ length: 100 }, (_, index) => ({
    document_id: "approved-document",
    page: index === 99 ? 99 : index + 1,
  }));

  assert.throws(
    () =>
      assertApprovedReindexScope(records, {
        expectedDocuments: 100,
        expectedLogicalDocuments: 1,
      }),
    /approved reindex scope/i
  );
});

test("임시 컬렉션과 이전 컬렉션 이름은 운영 컬렉션과 충돌하지 않는다", () => {
  const names = buildReindexCollectionNames(
    "schat-2026-09-22",
    "20260923-200000"
  );

  assert.equal(names.live, "schat-2026-09-22");
  assert.equal(names.staging, "schat-2026-09-22-reindex-20260923-200000");
  assert.equal(names.previous, "schat-2026-09-22-before-20260923-200000");
  assert.equal(new Set(Object.values(names)).size, 3);
});

test("page와 명시된 section 보존 수만 집계하고 원문은 결과에 포함하지 않는다", () => {
  const summary = summarizeReindexMetadata([
    { metadata: { page: 7, section: "수혈 종류" }, text: "민감 원문" },
    { metadata: { page: 8 }, text: "다른 원문" },
  ]);

  assert.deepEqual(summary, {
    vectorCount: 2,
    pageMetadataCount: 2,
    sectionMetadataCount: 1,
  });
  assert.equal(JSON.stringify(summary).includes("민감 원문"), false);
});

test("Chroma metadata에는 값이 있는 문자열·숫자·불리언만 저장한다", () => {
  assert.deepEqual(
    sanitizeChromaMetadata({
      title: "수혈간호.pdf",
      page: 7,
      section: "",
      published: null,
      nested: { hidden: true },
      active: true,
    }),
    { title: "수혈간호.pdf", page: 7, active: true }
  );
});
