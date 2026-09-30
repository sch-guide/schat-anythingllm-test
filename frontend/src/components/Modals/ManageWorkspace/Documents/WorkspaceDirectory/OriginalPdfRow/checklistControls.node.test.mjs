import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function source(relativePath) {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

test("original PDF row exposes checklist view, edit, and source page actions", () => {
  const controls = source("./ChecklistControls.jsx");
  assert.match(controls, /체크리스트 보기/);
  assert.match(controls, /수정/);
  assert.match(controls, /원본 보기 p\.\{checklist\.source\.page\}/);
  assert.match(controls, /<ChecklistEditor/);
  assert.match(controls, /setOpenMode\("view"\)/);
  assert.match(controls, /setOpenMode\("edit"\)/);
  assert.match(controls, /onOpenSource=/);
  assert.match(controls, /PdfPageViewer/);
});

test("editor changes only the checklist definition through Checklist.update", () => {
  const editor = source("./ChecklistEditor.jsx");
  const tree = source(
    "../../../../../WorkspaceChat/ChatContainer/ChatHistory/Checklist/ChecklistTree.jsx"
  );
  assert.match(editor, /Checklist\.update/);
  assert.match(tree, /section\.title/);
  assert.match(tree, /item\.label/);
  assert.match(tree, /item\.details/);
  assert.match(tree, /항목 추가/);
  assert.match(tree, /항목 삭제/);
  assert.doesNotMatch(editor, /Chroma|BM25|embedding|modifyEmbeddings/);
});

test("workspace directory loads every checklist of a PDF (review included) by public pdfRef", () => {
  const directory = source("../index.jsx");
  assert.match(
    directory,
    /Checklist\.list\(workspace\.slug, \{ scope: "admin" \}\)/
  );
  assert.match(directory, /checklist\.source\?\.pdfRef === row\.pdfRef/);
  assert.match(directory, /checklists=\{checklists\.filter\(/);
});

test("document row lists all checklists and reuses the existing controls without approval", () => {
  const list = source("./ChecklistList.jsx");
  assert.match(list, /<ChecklistControls/);
  assert.match(list, /검토 필요/);
  assert.doesNotMatch(list, /승인|approve/i);
});
