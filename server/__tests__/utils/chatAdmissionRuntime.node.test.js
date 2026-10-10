const test = require("node:test");
const assert = require("node:assert/strict");
const { createRuntime } = require("../../utils/chatAdmissionRuntime");

test("saved limit survives new runtime, live counts do not", async () => {
  let stored = null;
  const storage = {
    read: async () => stored,
    write: async (value) => {
      stored = value;
    },
  };
  const first = createRuntime(storage);
  await first.save(2);
  const lease = await (await first.ready()).acquire("u");
  const second = createRuntime(storage);
  assert.deepEqual((await second.ready()).snapshot(), {
    active: 0,
    waiting: 0,
    maxActive: 2,
    maxWaiting: 10,
  });
  lease.release();
});
test("invalid or failed save never changes current limit", async () => {
  const runtime = createRuntime({
    read: async () => null,
    write: async () => {
      throw new Error("disk");
    },
  });
  await assert.rejects(runtime.save(0), { code: "SCHAT_INVALID_LIMIT" });
  await assert.rejects(runtime.save(8), /disk/);
  assert.equal((await runtime.ready()).snapshot().maxActive, 4);
});
test("failed load rejects admission initialization instead of silently ignoring saved policy", async () => {
  const runtime = createRuntime({
    read: async () => {
      throw new Error("offline");
    },
    write: async () => {},
  });
  await assert.rejects(runtime.ready(), /offline/);
});
