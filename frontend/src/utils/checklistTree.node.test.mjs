import test from "node:test";
import assert from "node:assert/strict";
import {
  detailKey,
  isInformationalItem,
  isNoteDetail,
  parentState,
  toggleDetail,
  toggleParent,
} from "./checklistTree.js";

const scope = { checklistId: "renal", sectionId: "before" };
const consent = {
  id: "consent",
  type: "checkable",
  label: "동의서",
  details: ["초음파유도하 신장조직검사 동의서", "시술 전 환자 점검표(출력)"],
};

test("purpose and place/transport rows are read-only even if stored as checkable", () => {
  assert.equal(
    isInformationalItem({ type: "informational", label: "검사목적" }),
    true
  );
  assert.equal(
    isInformationalItem({ type: "checkable", label: "검사장소/이동수단" }),
    true
  );
  assert.equal(isInformationalItem(consent), false);
  assert.equal(
    isInformationalItem({ type: "checkable", label: "IV line" }),
    false
  );
});

test("parent click selects every child, second click clears every child", () => {
  const all = toggleParent(scope, consent, {});
  assert.equal(all[detailKey(scope, "consent", 0)], true);
  assert.equal(all[detailKey(scope, "consent", 1)], true);
  assert.equal(parentState(scope, consent, all), "checked");
  const none = toggleParent(scope, consent, all);
  assert.equal(parentState(scope, consent, none), "unchecked");
});

test("partial children make the parent indeterminate and a parent click completes them", () => {
  const partial = toggleDetail(scope, consent, 0, {});
  assert.equal(parentState(scope, consent, partial), "indeterminate");
  const completed = toggleParent(scope, consent, partial);
  assert.equal(parentState(scope, consent, completed), "checked");
});

test("checking every child individually makes the parent checked", () => {
  const one = toggleDetail(scope, consent, 0, {});
  const both = toggleDetail(scope, consent, 1, one);
  assert.equal(parentState(scope, consent, both), "checked");
  assert.equal(
    parentState(scope, consent, toggleDetail(scope, consent, 1, both)),
    "indeterminate"
  );
});

test("an item without detail lines behaves as a single checkbox", () => {
  const single = {
    id: "single",
    type: "checkable",
    label: "단일",
    details: [],
  };
  const on = toggleParent(scope, single, {});
  assert.equal(parentState(scope, single, on), "checked");
  assert.equal(
    parentState(scope, single, toggleParent(scope, single, on)),
    "unchecked"
  );
});

test("keys include checklist, section, item and child so equal labels never share state", () => {
  const other = { checklistId: "pcn", sectionId: "before" };
  const renalChecked = toggleParent(scope, consent, {});
  assert.equal(parentState(other, consent, renalChecked), "unchecked");
  assert.equal(detailKey(scope, "consent", 1), "renal:before:consent:1");
  assert.notEqual(
    detailKey(scope, "consent", 1),
    detailKey(other, "consent", 1)
  );
});

test("※ remarks and parenthesised-only lines are notes, not checkboxes", () => {
  assert.equal(isNoteDetail("※ 가상 참고"), true);
  assert.equal(isNoteDetail("(가상 설명 (보충))"), true);
  assert.equal(isNoteDetail("가상 확인 (필수)"), false);
  const item = {
    id: "prep",
    type: "checkable",
    label: "준비",
    details: ["가상 준비", "※ 참고"],
  };
  const all = toggleParent(scope, item, {});
  assert.equal(parentState(scope, item, all), "checked");
  assert.equal(all[detailKey(scope, "prep", 1)], undefined);
});
