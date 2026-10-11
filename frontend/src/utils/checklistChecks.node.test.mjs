import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  checklistChecksKey,
  elapsedLabel,
  loadChecklistChecks,
  parseChecklistChecks,
  saveChecklistChecks,
  serializeChecklistChecks,
} from "./checklistChecks.js";

function memoryStorage() {
  const data = new Map();
  return {
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => data.set(key, String(value)),
    removeItem: (key) => data.delete(key),
    data,
  };
}

const MINUTE = 60 * 1000;

test("checks are kept per user and per checklist", () => {
  assert.notEqual(checklistChecksKey(1, "pcd"), checklistChecksKey(2, "pcd"));
  assert.notEqual(checklistChecksKey(1, "pcd"), checklistChecksKey(1, "pcn"));
  assert.match(checklistChecksKey(undefined, "pcd"), /guest:pcd$/);
});

test("saved checks and the time of the last change come back after reopening", () => {
  const storage = memoryStorage();
  const key = checklistChecksKey(7, "pcd");
  const at = Date.UTC(2026, 9, 10, 9, 0);
  saveChecklistChecks(
    storage,
    key,
    { "pcd:s1:i1:0": true, "pcd:s1:i1:1": false },
    at
  );
  assert.deepEqual(loadChecklistChecks(storage, key), {
    checks: { "pcd:s1:i1:0": true },
    updatedAt: at,
  });
});

test("clearing every check removes the saved entry", () => {
  const storage = memoryStorage();
  const key = checklistChecksKey(7, "pcd");
  saveChecklistChecks(storage, key, { a: true });
  saveChecklistChecks(storage, key, {});
  assert.equal(storage.data.has(key), false);
  assert.equal(serializeChecklistChecks({ a: false }), null);
  assert.deepEqual(loadChecklistChecks(storage, key), {
    checks: {},
    updatedAt: null,
  });
});

test("checks saved without a time are still read, with an unknown time", () => {
  assert.deepEqual(parseChecklistChecks('{"a":true,"b":false}'), {
    checks: { a: true },
    updatedAt: null,
  });
});

test("broken or blocked storage gives an empty checklist instead of an error", () => {
  const empty = { checks: {}, updatedAt: null };
  assert.deepEqual(parseChecklistChecks("{not json"), empty);
  assert.deepEqual(parseChecklistChecks("[1,2]"), empty);
  assert.deepEqual(parseChecklistChecks('{"checks":{"a":"yes","b":true}}'), {
    checks: { b: true },
    updatedAt: null,
  });
  const blocked = {
    getItem() {
      throw new Error("blocked");
    },
    setItem() {
      throw new Error("blocked");
    },
    removeItem() {
      throw new Error("blocked");
    },
  };
  assert.deepEqual(loadChecklistChecks(blocked, "k"), empty);
  assert.doesNotThrow(() => saveChecklistChecks(blocked, "k", { a: true }));
});

test("elapsed time reads as 방금 전 / 분 전 / 시간 전 / 일 전", () => {
  const now = Date.UTC(2026, 9, 10, 12, 0);
  assert.equal(elapsedLabel(now - 30 * 1000, now), "방금 전");
  assert.equal(elapsedLabel(now - 5 * MINUTE, now), "5분 전");
  assert.equal(elapsedLabel(now - 59 * MINUTE, now), "59분 전");
  assert.equal(elapsedLabel(now - 60 * MINUTE, now), "1시간 전");
  assert.equal(elapsedLabel(now - 23 * 60 * MINUTE, now), "23시간 전");
  assert.equal(elapsedLabel(now - 50 * 60 * MINUTE, now), "2일 전");
  assert.equal(elapsedLabel(now + 5 * MINUTE, now), "방금 전");
  assert.equal(elapsedLabel(null, now), null);
});

test("floating panel and separate window share the saved checks, reset and leftover notice", () => {
  const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
  const panel = read(
    "../components/WorkspaceChat/ChatContainer/ChatHistory/Checklist/ChecklistFloatingPanel.jsx"
  );
  const popup = read("../pages/ChecklistPopup/index.jsx");
  const hook = read("../hooks/useChecklistChecks.js");
  const notice = read(
    "../components/WorkspaceChat/ChatContainer/ChatHistory/Checklist/ChecklistLeftoverNotice.jsx"
  );
  for (const screen of [panel, popup]) {
    assert.match(screen, /useChecklistPersonalState\(/);
    assert.match(screen, /<ChecklistResetButton/);
    assert.match(screen, /<ChecklistLeftoverNotice/);
  }
  assert.match(panel, /useChecklistPersonalState\(checklist\?\.id, isOpen\)/);
  assert.match(hook, /addEventListener\("storage"/);
  assert.match(hook, /user\?\.id/);
  assert.match(notice, /이전 체크가 남아 있습니다/);
  // The notice only warns; nothing clears checks automatically.
  assert.doesNotMatch(notice, /onReset|resetCheckedItems|setCheckedItems/);
  assert.doesNotMatch(hook, /useEffect\([^)]*resetCheckedItems/);
});
