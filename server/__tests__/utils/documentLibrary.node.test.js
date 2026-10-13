const test = require("node:test");
const assert = require("node:assert/strict");
const { summarize } = require("../../utils/documentLibrary");

const file = (docpath, title, documentId, page, published = "2026-10-01") => ({
  docpath,
  folderName: "custom-documents",
  name: docpath.split("/").pop(),
  id: docpath,
  title,
  documentId,
  page,
  published,
});

test("쪽 파일을 문서 하나로 묶고 등록 상태·쪽 수를 셈", () => {
  const files = [
    file("custom-documents/a1.json", "검사 및 시술.pdf", "A", 1),
    file("custom-documents/a2.json", "검사 및 시술.pdf", "A", 2),
    file("custom-documents/b1.json", "수술.pdf", "B", 1, "2026-10-12"),
    file("custom-documents/c1.json", "검사 및 시술.pdf", "C", 1, "2026-09-01"),
    file("custom-documents/d1.json", "예전.pdf", "D", 1),
  ];
  const rows = [
    { docpath: "custom-documents/a1.json", workspaceId: 1, metadata: "{}" },
    { docpath: "custom-documents/a2.json", workspaceId: 1, metadata: "{}" },
    {
      docpath: "custom-documents/d1.json",
      workspaceId: 1,
      metadata: '{"schat_document_update_archived":true}',
    },
  ];
  const docs = summarize(files, rows, 1, (m) => ({
    pdfRef: `ref-${m.document_id}`,
  }));
  const by = Object.fromEntries(docs.map((d) => [d.documentId, d]));
  assert.equal(by.A.status, "registered");
  assert.equal(by.A.pages, 2);
  assert.equal(by.A.pdfRef, "ref-A");
  assert.equal(by.B.status, "unregistered");
  assert.equal(by.B.freeFiles.length, 1);
  assert.equal(by.B.pdfRef, undefined);
  assert.equal(by.C.olderCopy, true);
  assert.equal(by.D, undefined, "이전 버전(보관)은 목록에서 뺌");
  assert.equal(docs.at(-1).documentId, "C", "예전 업로드는 맨 아래");
  assert.equal(JSON.stringify(docs).includes("pageContent"), false);
});
