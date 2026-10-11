import test from "node:test";
import assert from "node:assert/strict";
import { maskChecklistPatient } from "./checklistPatientMask.js";

// All names below are synthetic examples, never copied from patient records.
for (const [input, expected] of [
  ["612호 / 홍길", "612호 / 홍○"],
  ["612호 / 홍길동", "612호 / 홍○동"],
  ["612호 / 남궁민수", "612호 / 남○○수"],
  ["612호 / 가나다라마", "612호 / 가○○○마"],
  ["612호 홍길동", "612호 홍○동"],
  ["612호홍길동", "612호홍○동"],
  ["홍길동 612호", "홍○동 612호"],
  ["612호 / 홍○동", "612호 / 홍○동"],
  ["612호 / 남○민수", "612호 / 남○○수"],
  ["612호 가나다라마", "612호 가○○○마"],
  ["612호", "612호"],
  ["", ""],
]) {
  test(`synthetic patient masking: ${input}`, () => {
    assert.equal(maskChecklistPatient(input), expected);
    assert.equal(maskChecklistPatient(expected), expected);
  });
}
