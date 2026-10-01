import test from "node:test";
import assert from "node:assert/strict";
import {
  employeeDocumentName,
  hideEmployeeSourcePages,
} from "./schatSourceDisplay.js";

test("employee source labels show the document name without a page", () => {
  assert.equal(
    employeeDocumentName({
      title: "검사 및 시술.pdf · p.13 · 준비",
      page: 13,
    }),
    "검사 및 시술.pdf"
  );
});

test("answer display hides only page labels attached to PDF sources", () => {
  assert.equal(
    hideEmployeeSourcePages(
      "출처: 검사 및 시술.pdf · p.13\n수혈 시작 후 15분 동안 관찰함."
    ),
    "출처: 검사 및 시술.pdf\n수혈 시작 후 15분 동안 관찰함."
  );
  assert.equal(
    hideEmployeeSourcePages("근거: 수술.pdf, 13쪽"),
    "근거: 수술.pdf"
  );
});
