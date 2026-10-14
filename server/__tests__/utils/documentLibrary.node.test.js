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
  assert.equal(by.B.pdfRef, "ref-B", "등록 전 문서도 원본 링크를 가짐(관리자 원본 보기)");
  assert.equal(by.C.olderCopy, true);
  assert.equal(by.D, undefined, "이전 버전(보관)은 목록에서 뺌");
  assert.equal(docs.at(-1).documentId, "C", "예전 업로드는 맨 아래");
  assert.equal(JSON.stringify(docs).includes("pageContent"), false);
});

test("예전 버전 체크리스트는 화면에서 빼고, 같은 이름 업데이트 뒤 새 버전 체크리스트를 다시 만듦", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const ws = fs.readFileSync(path.join(__dirname, "../../endpoints/workspaces.js"), "utf8");
  const fn = ws.slice(ws.indexOf("function workspaceDocumentIds"), ws.indexOf("async function logUploadFailure"));
  assert.match(fn, /schat_document_update_archived === true\) return ""/);
  const update = ws.slice(ws.indexOf("'/workspace/:slug/document-update'"), ws.indexOf("scheduleSynonymSuggestions(", ws.indexOf("'/workspace/:slug/document-update'")));
  assert.match(update, /processDocumentChecklists\(/);
  const personal = fs.readFileSync(path.join(__dirname, "../../endpoints/checklistPersonalState.js"), "utf8");
  assert.match(personal, /schat_document_update_archived !== true/);
});

test("문서 번호 없는 예전 형식 파일도 이름으로 안전 점검 열쇠를 받음", () => {
  const files = [file("custom-documents/old-sheet.json", "가상전화번호부.xlsx - Sheet:Sheet1", null, null)];
  const [doc] = summarize(files, [], 1, () => ({}), (id) => `doc:${id}`, (title) => `title:${title}`);
  assert.equal(doc.status, "unregistered");
  assert.equal(doc.cleanupKey, "title:가상전화번호부.xlsx - Sheet:Sheet1");
  const [withId] = summarize([file("custom-documents/a.json", "가.pdf", "D1", 1)], [], 1, () => ({}), (id) => `doc:${id}`, (t) => `title:${t}`);
  assert.equal(withId.cleanupKey, "doc:D1");
});
