import test from "node:test";
import assert from "node:assert/strict";
import { updateAdmission, admissionPosition, generationStartedAt, resetAdmission } from "./chatAdmissionDisplay.mjs";
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

test("regenerating the same question starts a fresh clock without mutating saved history", () => {
  const old = updateAdmission([{role: "user", content: "테스트"}], 0, 1000);
  const retry = resetAdmission(old);
  assert.equal(generationStartedAt(retry), null);
  assert.equal(generationStartedAt(old), 1000);
  assert.equal(generationStartedAt(updateAdmission(retry, 0, 150000)), 150000);
});

test("generation clock starts on admission, not on queue entry, and survives status replacement", () => {
  let history = updateAdmission([{ role: "user", content: "테스트" }], 2, 1000);
  assert.equal(generationStartedAt(history), null);
  history = updateAdmission(history, 1, 20000);
  assert.equal(generationStartedAt(history), null);
  history = updateAdmission(history, 0, 29000);
  assert.equal(generationStartedAt(history), 29000);
  history = updateAdmission(history, 0, 30000);
  assert.equal(generationStartedAt(history), 29000);
  history = history.filter((item) => !item.admission);
  assert.equal(generationStartedAt(history), 29000);
  assert.equal(generationStartedAt([...history, { role: "user", content: "다음" }]), null);
});
