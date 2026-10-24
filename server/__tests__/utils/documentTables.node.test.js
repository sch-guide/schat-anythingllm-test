// 2026-10-24: 표의 행·열이 사라져 "72시간 유효"를 다른 열 내용으로 읽던 문제.
// 쪽별 "표 정리"를 따로 저장하고, 그 쪽이 근거로 잡히면 답변 근거 뒤에 붙인다. 가상 자료만 쓴다.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

test("표 정리 저장·읽기, '표 없음' 기록, 잘못된 쪽 거부", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "schat-tables-"));
  const store = require("../../utils/documentTables/store");
  assert.equal(store.readTableText("doc-1", 3, { storageRoot: root }), "");
  assert.equal(store.hasTableRecord("doc-1", 3, { storageRoot: root }), false);
  store.writeTableText("doc-1", 3, "가상검사 | 열A: 72시간 | 열B: 첫 수혈 시", { model: "m", storageRoot: root });
  assert.equal(store.readTableText("doc-1", 3, { storageRoot: root }), "가상검사 | 열A: 72시간 | 열B: 첫 수혈 시");
  store.writeTableText("doc-1", 4, "", { storageRoot: root });
  assert.equal(store.hasTableRecord("doc-1", 4, { storageRoot: root }), true);
  assert.equal(store.readTableText("doc-1", 4, { storageRoot: root }), "");
  assert.throws(() => store.writeTableText("doc-1", "../x", "a", { storageRoot: root }));
});

test("답변 근거에 같은 쪽의 표 정리를 한 번만 붙이고, 없으면 그대로 둔다", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "schat-tables-"));
  process.env.STORAGE_DIR = root;
  const tablesRoot = path.join(root, "document-tables");
  const store = require("../../utils/documentTables/store");
  store.writeTableText("doc-9", 5, "가상검사 | 열A: 72시간 유효 | 열B: 첫 수혈 시", { storageRoot: tablesRoot });
  const { buildRagContext } = require("../../utils/agents/aibitat/utils/ragSources");
  const context = buildRagContext([
    { document_id: "doc-9", page: 5, text: "열A 열B 가상검사 72시간 유효 첫 수혈 시", title: "가상.pdf" },
    { document_id: "doc-9", page: 5, text: "같은 쪽 다른 조각", title: "가상.pdf" },
    { document_id: "doc-9", page: 6, text: "표 없는 쪽", title: "가상.pdf" },
  ]);
  assert.equal(context.match(/\[이 쪽의 표를 행·열대로 옮긴 정리\]/g).length, 1);
  assert.match(context, /가상검사 \| 열A: 72시간 유효 \| 열B: 첫 수혈 시/);
  assert.match(context, /표 없는 쪽/);
});

test("모델 답이 '표 없음'이면 빈 글로 저장하고 굵은 글씨 표시는 뺀다", () => {
  const { cleanTranscription } = require("../../scripts/schatBackfillTableTranscriptions");
  assert.equal(cleanTranscription("표 없음"), "");
  assert.equal(cleanTranscription(" 표 없음. "), "");
  assert.equal(cleanTranscription("**표: 검사 주기**\n행 | 열: 값"), "표: 검사 주기\n행 | 열: 값");
});
