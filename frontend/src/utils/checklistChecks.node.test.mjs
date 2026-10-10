import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  checklistChecksKey,
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

test("checks are kept per user and per checklist", () => {
  assert.notEqual(checklistChecksKey(1, "pcd"), checklistChecksKey(2, "pcd"));
  assert.notEqual(checklistChecksKey(1, "pcd"), checklistChecksKey(1, "pcn"));
  assert.match(checklistChecksKey(undefined, "pcd"), /guest:pcd$/);
});

test("saved checks come back after closing and reopening", () => {
  const storage = memoryStorage();
  const key = checklistChecksKey(7, "pcd");
  saveChecklistChecks(storage, key, {
    "pcd:s1:i1:0": true,
    "pcd:s1:i1:1": false,
  });
  assert.deepEqual(loadChecklistChecks(storage, key), { "pcd:s1:i1:0": true });
});

test("clearing every check removes the saved entry", () => {
  const storage = memoryStorage();
  const key = checklistChecksKey(7, "pcd");
  saveChecklistChecks(storage, key, { a: true });
  saveChecklistChecks(storage, key, {});
  assert.equal(storage.data.has(key), false);
  assert.equal(serializeChecklistChecks({ a: false }), null);
});

test("broken or blocked storage gives an empty checklist instead of an error", () => {
  assert.deepEqual(parseChecklistChecks("{not json"), {});
  assert.deepEqual(parseChecklistChecks("[1,2]"), {});
  assert.deepEqual(parseChecklistChecks('{"a":"yes","b":true}'), { b: true });
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
  assert.deepEqual(loadChecklistChecks(blocked, "k"), {});
  assert.doesNotThrow(() => saveChecklistChecks(blocked, "k", { a: true }));
});

test("floating panel and separate window share the saved checks and a reset", () => {
  const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
  const panel = read(
    "../components/WorkspaceChat/ChatContainer/ChatHistory/Checklist/ChecklistFloatingPanel.jsx"
  );
  const popup = read("../pages/ChecklistPopup/index.jsx");
  const hook = read("../hooks/useChecklistChecks.js");
  for (const screen of [panel, popup]) {
    assert.match(screen, /useChecklistChecks\(/);
    assert.match(screen, /<ChecklistResetButton/);
    assert.doesNotMatch(
      screen,
      /useState\(\{\}\);\n\s*const \[expandedSections/
    );
  }
  assert.match(hook, /addEventListener\("storage"/);
  assert.match(hook, /user\?\.id/);
});
