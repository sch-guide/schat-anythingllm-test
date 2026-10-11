import test from "node:test";
import assert from "node:assert/strict";
const api = await import("./answerFeedback.mjs").catch(() => ({}));
test("실패한 저장은 원래 선택을 보존하고 재시도 가능", async () => {
  assert.equal(typeof api.createFeedbackController, "function");
  const states = [];
  let ok = false;
  const controller = api.createFeedbackController({
    initial: true,
    save: async () => ok,
    onChange: (s) => states.push(s),
  });
  assert.equal(
    await controller.submit(false, { reason: "wrong", memo: "합성 메모" }),
    false
  );
  assert.equal(controller.selected, true);
  ok = true;
  assert.equal(await controller.submit(false, { reason: "wrong" }), true);
  assert.equal(controller.selected, false);
  assert.equal(await controller.submit(null), true);
  assert.equal(controller.selected, null);
  assert.deepEqual(
    states.filter((s) => !s.pending).map((s) => s.selected),
    [true, false, null]
  );
});
test("전송 중 중복 클릭을 차단하고 예외 후 잠금을 해제", async () => {
  assert.equal(typeof api.createFeedbackController, "function");
  let release,
    calls = 0;
  const controller = api.createFeedbackController({
    initial: null,
    save: () => {
      calls++;
      return new Promise((resolve) => (release = resolve));
    },
  });
  const first = controller.submit(true);
  assert.equal(await controller.submit(false, { reason: "wrong" }), false);
  assert.equal(calls, 1);
  release(true);
  await first;
  assert.equal(controller.selected, true);
  const broken = api.createFeedbackController({
    initial: true,
    save: async () => {
      throw new Error("offline");
    },
  });
  assert.equal(await broken.submit(null), false);
  assert.equal(broken.pending, false);
  assert.equal(broken.selected, true);
});
