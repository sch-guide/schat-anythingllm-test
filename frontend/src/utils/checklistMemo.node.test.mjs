import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  MEMO_TTL_MS,
  checklistMemoKey,
  checklistMemoPrefix,
  hasMemo,
  loadChecklistMemo,
  memoSessionId,
  purgeChecklistMemos,
  saveChecklistMemo,
} from "./checklistMemo.js";

function memoryStorage(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    get length() {
      return data.size;
    },
    key: (i) => [...data.keys()][i] ?? null,
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => data.set(key, String(value)),
    removeItem: (key) => data.delete(key),
    data,
  };
}

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const NOW = Date.UTC(2026, 9, 10, 9, 0);
const memo = { patient: "612호 / 김민지", other: "보호자 연락 완료" };

test("notes are separated by user, login session and checklist", () => {
  const session = memoSessionId("token-a");
  assert.notEqual(session, memoSessionId("token-b"));
  assert.equal(memoSessionId(null), "local");
  assert.ok(!session.includes("token"), "the token itself is not stored");
  const keys = new Set([
    checklistMemoKey(1, session, "pcd"),
    checklistMemoKey(2, session, "pcd"),
    checklistMemoKey(1, memoSessionId("token-b"), "pcd"),
    checklistMemoKey(1, session, "perm"),
  ]);
  assert.equal(keys.size, 4);
});

test("a note comes back on the same checklist and not on another one", () => {
  const storage = memoryStorage();
  const s = memoSessionId("t");
  saveChecklistMemo(storage, checklistMemoKey(1, s, "pcd"), memo, NOW);
  assert.deepEqual(
    loadChecklistMemo(storage, checklistMemoKey(1, s, "pcd"), NOW),
    {
      ...memo,
      updatedAt: NOW,
    }
  );
  assert.equal(
    hasMemo(loadChecklistMemo(storage, checklistMemoKey(1, s, "perm"), NOW)),
    false
  );
});

test("multi-line text is kept as typed", () => {
  const storage = memoryStorage();
  const key = checklistMemoKey(1, "s", "pcd");
  saveChecklistMemo(
    storage,
    key,
    { patient: "612호\n김민지\n", other: "" },
    NOW
  );
  assert.equal(loadChecklistMemo(storage, key, NOW).patient, "612호\n김민지\n");
});

test("emptying both notes removes the saved entry", () => {
  const storage = memoryStorage();
  const key = checklistMemoKey(1, "s", "pcd");
  saveChecklistMemo(storage, key, memo, NOW);
  saveChecklistMemo(storage, key, { patient: " ", other: "" }, NOW);
  assert.equal(storage.data.has(key), false);
});

test("notes expire 12 hours after the last edit", () => {
  const storage = memoryStorage();
  const key = checklistMemoKey(1, "s", "pcd");
  saveChecklistMemo(storage, key, memo, NOW);
  assert.equal(
    hasMemo(loadChecklistMemo(storage, key, NOW + MEMO_TTL_MS - 1)),
    true
  );
  assert.equal(
    hasMemo(loadChecklistMemo(storage, key, NOW + MEMO_TTL_MS + 1)),
    false
  );
});

test("opening a checklist removes other users', earlier sessions' and expired notes", () => {
  const storage = memoryStorage();
  const mine = checklistMemoKey(1, "now", "pcd");
  const otherUser = checklistMemoKey(2, "now", "pcd");
  const oldSession = checklistMemoKey(1, "before", "pcd");
  const expired = checklistMemoKey(1, "now", "perm");
  const checks = "schat_checklist_checks:1:pcd";
  saveChecklistMemo(storage, mine, memo, NOW);
  saveChecklistMemo(storage, otherUser, memo, NOW);
  saveChecklistMemo(storage, oldSession, memo, NOW);
  saveChecklistMemo(storage, expired, memo, NOW - MEMO_TTL_MS - 1);
  storage.setItem(checks, '{"checks":{"a":true}}');
  purgeChecklistMemos(storage, checklistMemoPrefix(1, "now"), NOW);
  assert.deepEqual([...storage.data.keys()].sort(), [checks, mine].sort());
});

test("logout removes every note but keeps saved checks", () => {
  const storage = memoryStorage();
  saveChecklistMemo(storage, checklistMemoKey(1, "now", "pcd"), memo, NOW);
  storage.setItem("schat_checklist_checks:1:pcd", '{"checks":{"a":true}}');
  purgeChecklistMemos(storage);
  assert.deepEqual([...storage.data.keys()], ["schat_checklist_checks:1:pcd"]);
  const logout = read("../components/UserMenu/UserButton/index.jsx");
  assert.match(logout, /purgeChecklistMemos\(window\.localStorage\)/);
});

test("employee screens: 환자정보 above the checklist, 기타메모 below, blue tone", () => {
  for (const path of [
    "../components/WorkspaceChat/ChatContainer/ChatHistory/Checklist/ChecklistFloatingPanel.jsx",
    "../pages/ChecklistPopup/index.jsx",
  ]) {
    const screen = read(path);
    const patient = screen.indexOf('title="환자정보"');
    const tree = screen.indexOf("<ChecklistTree");
    const other = screen.indexOf('title="기타메모"');
    assert.ok(patient > 0 && patient < tree && tree < other, path);
    assert.match(screen, /placeholder="예: 612호 \/ 김민지"/);
    assert.match(screen, /placeholder="추가로 기록할 내용을 입력하세요"/);
    assert.match(screen, /tone="blue"/);
    assert.match(screen, /title="환자정보"\s+compact/);
    assert.doesNotMatch(screen, /title="기타메모"\s+compact/);
    assert.match(screen, /useChecklistPersonalState\(/);
    assert.doesNotMatch(screen, /환자정보 \(/);
  }
});

test("notes stay in the browser and apart from checks and checklist data", () => {
  const hook = read("../hooks/useChecklistMemo.js");
  const card = read(
    "../components/WorkspaceChat/ChatContainer/ChatHistory/Checklist/ChecklistMemo.jsx"
  );
  const util = read("./checklistMemo.js");
  for (const source of [hook, card, util]) {
    assert.doesNotMatch(
      source,
      /fetch\(|API_BASE|@\/models\/|sendCommand|console\./
    );
  }
  // 체크 모두 해제 only clears checks.
  const checksHook = read("../hooks/useChecklistChecks.js");
  assert.doesNotMatch(checksHook, /Memo/);
  assert.match(card, /<textarea/);
  // 환자정보 is a small one-line box (52px, grows to ~3 lines); 기타메모
  // keeps the large 3-row box.
  assert.match(card, /rows=\{compact \? 1 : 3\}/);
  assert.match(card, /COMPACT_MIN = 52/);
  assert.match(card, /min-h-\[88px\] resize-y/);
});

test("administrator checklist screens keep the default look", () => {
  const editor = read(
    "../components/Modals/ManageWorkspace/Documents/WorkspaceDirectory/OriginalPdfRow/ChecklistEditor.jsx"
  );
  assert.doesNotMatch(editor, /tone=|ChecklistMemo|useChecklistMemo/);
  const tree = read(
    "../components/WorkspaceChat/ChatContainer/ChatHistory/Checklist/ChecklistTree.jsx"
  );
  assert.match(tree, /tone = "default"/);
});
