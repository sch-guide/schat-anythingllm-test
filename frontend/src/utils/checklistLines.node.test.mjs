import test from "node:test";
import assert from "node:assert/strict";
import {
  addLine,
  cleanItemLines,
  moveLine,
  removeLine,
  setLineCheckable,
  updateLine,
} from "./checklistLines.js";

const item = {
  id: "consent",
  type: "checkable",
  label: "동의서",
  details: ["① 가상 동의서", "② 가상 확인(EMR)", "※ 가상 참고"],
};

test("an untouched item keeps no per-line setting (existing look kept)", () => {
  const edited = moveLine(addLine(updateLine(item, 0, "① 수정")), 0, 1);
  assert.equal("detailCheckable" in edited, false);
  assert.equal("detailCheckable" in cleanItemLines(edited), false);
  assert.deepEqual(cleanItemLines(edited).details, [
    "② 가상 확인(EMR)",
    "① 수정",
    "※ 가상 참고",
  ]);
});

test("the first checkbox change records every line, then lines stay aligned", () => {
  let edited = setLineCheckable(item, 1, false);
  assert.deepEqual(edited.detailCheckable, [true, false, false]);
  edited = moveLine(edited, 1, -1);
  assert.deepEqual(edited.details.slice(0, 2), [
    "② 가상 확인(EMR)",
    "① 가상 동의서",
  ]);
  assert.deepEqual(edited.detailCheckable, [false, true, false]);
  edited = addLine(edited);
  assert.deepEqual(edited.detailCheckable, [false, true, false, true]);
  edited = removeLine(edited, 0);
  assert.deepEqual(edited.detailCheckable, [true, false, true]);
  // the new empty line is removed on save together with its setting
  const saved = cleanItemLines(edited);
  assert.deepEqual(saved.details, ["① 가상 동의서", "※ 가상 참고"]);
  assert.deepEqual(saved.detailCheckable, [true, false]);
});
