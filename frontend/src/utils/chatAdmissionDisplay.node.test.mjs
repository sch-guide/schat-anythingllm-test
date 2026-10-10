import test from "node:test";
import assert from "node:assert/strict";
import { updateAdmission, admissionPosition } from "./chatAdmissionDisplay.mjs";
test("queue update replaces old position without losing question; admitted run clears position", () => {
  const question = { role: "user", content: "테스트" };
  let history = updateAdmission([question], 3);
  history = updateAdmission(history, 1);
  assert.equal(history.length, 2);
  assert.equal(history[0], question);
  assert.equal(admissionPosition(history), 1);
  assert.equal(admissionPosition(updateAdmission(history, 0)), null);
  assert.equal(updateAdmission(history, 0).at(-1).animate, true);
  assert.equal(
    admissionPosition([...history, { role: "user", content: "다음 질문" }]),
    null
  );
});
