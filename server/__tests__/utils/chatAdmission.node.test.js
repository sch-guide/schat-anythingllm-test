const test = require("node:test");
const assert = require("node:assert/strict");
const { createAdmission } = require("../../utils/chatAdmission");

function clock() {
  let time = 0,
    id = 0;
  const tasks = new Map();
  return {
    setTimer(fn, ms) {
      const key = ++id;
      tasks.set(key, { at: time + ms, fn });
      return key;
    },
    clearTimer(key) {
      tasks.delete(key);
    },
    tick(ms) {
      const end = time + ms;
      while (true) {
        const next = [...tasks].sort((a, b) => a[1].at - b[1].at)[0];
        if (!next || next[1].at > end) break;
        time = next[1].at;
        tasks.delete(next[0]);
        next[1].fn();
      }
      time = end;
    },
  };
}

test("four requests run, fifth waits and enters when one finishes", async () => {
  const q = createAdmission(clock());
  const active = await Promise.all([1, 2, 3, 4].map((id) => q.acquire(id)));
  const positions = [];
  const fifth = q.acquire(5, { onPosition: (p) => positions.push(p) });
  assert.deepEqual(q.snapshot(), {
    active: 4,
    waiting: 1,
    maxActive: 4,
    maxWaiting: 10,
  });
  assert.deepEqual(positions, [1]);
  active[0].release();
  const lease = await fifth;
  assert.equal(q.snapshot().active, 4);
  active.forEach((x) => x.release());
  lease.release();
  assert.equal(q.snapshot().active, 0);
});

test("same account cannot enter while active or waiting", async () => {
  const q = createAdmission(clock());
  q.configure({ maxActive: 1 });
  const first = await q.acquire(1);
  await assert.rejects(q.acquire(1), { code: "SCHAT_DUPLICATE" });
  const waiting = q.acquire(2);
  await assert.rejects(q.acquire(2), { code: "SCHAT_DUPLICATE" });
  first.release();
  (await waiting).release();
});

test("FIFO updates positions when waiting client closes", async () => {
  const q = createAdmission(clock());
  q.configure({ maxActive: 1 });
  const first = await q.acquire(1),
    controller = new AbortController(),
    positions = [];
  const second = q.acquire(2, { signal: controller.signal });
  const rejected = assert.rejects(second, { code: "SCHAT_CANCELLED" });
  const third = q.acquire(3, { onPosition: (p) => positions.push(p) });
  controller.abort();
  await rejected;
  assert.deepEqual(positions, [2, 1]);
  first.release();
  (await third).release();
});

test("queue times out at 30 seconds and account can retry", async () => {
  const timer = clock(),
    q = createAdmission(timer);
  q.configure({ maxActive: 1 });
  const first = await q.acquire(1);
  const waiting = assert.rejects(q.acquire(2), { code: "SCHAT_QUEUE_TIMEOUT" });
  timer.tick(29999);
  assert.equal(q.snapshot().waiting, 1);
  timer.tick(1);
  await waiting;
  assert.equal(q.snapshot().waiting, 0);
  first.release();
  (await q.acquire(2)).release();
});

test("queue rejects overflow without retaining the rejected user", async () => {
  const q = createAdmission(clock());
  const active = await Promise.all([1, 2, 3, 4].map((id) => q.acquire(id)));
  const waiting = Array.from({ length: 10 }, (_, i) => q.acquire(i + 10));
  await assert.rejects(q.acquire(99), { code: "SCHAT_QUEUE_FULL" });
  assert.equal(q.snapshot().waiting, 10);
  active.forEach((x) => x.release());
  for (const pending of waiting) (await pending).release();
  (await q.acquire(99)).release();
});

test("generation timeout aborts before releasing and duplicate release is harmless", async () => {
  const timer = clock(),
    q = createAdmission(timer);
  q.configure({ maxActive: 1 });
  const first = await q.acquire(1);
  let activeAtAbort;
  first.signal.addEventListener("abort", () => {
    activeAtAbort = q.snapshot().active;
  });
  const second = q.acquire(2);
  // Second would otherwise expire while first runs: cancel and retry near expiry.
  const secondRejection = assert.rejects(second, {
    code: "SCHAT_QUEUE_TIMEOUT",
  });
  timer.tick(89999);
  await secondRejection;
  const next = q.acquire(3);
  timer.tick(1);
  const third = await next;
  assert.equal(activeAtAbort, 1);
  assert.equal(first.signal.reason.code, "SCHAT_GENERATION_TIMEOUT");
  first.release();
  first.release();
  assert.equal(q.snapshot().active, 1);
  third.release();
  assert.equal(q.snapshot().active, 0);
});

test("active disconnect releases slot and rejects already aborted requests", async () => {
  const q = createAdmission(clock()),
    controller = new AbortController();
  const lease = await q.acquire(1, { signal: controller.signal });
  controller.abort();
  assert.equal(lease.signal.aborted, true);
  assert.equal(q.snapshot().active, 0);
  await assert.rejects(q.acquire(2, { signal: controller.signal }), {
    code: "SCHAT_CANCELLED",
  });
  (await q.acquire(1)).release();
});

test("lowering limit preserves active requests, invalid settings do not mutate it", async () => {
  const q = createAdmission(clock());
  const first = await q.acquire(1),
    second = await q.acquire(2);
  q.configure({ maxActive: 1 });
  assert.equal(first.signal.aborted, false);
  const third = q.acquire(3);
  first.release();
  assert.equal(q.snapshot().waiting, 1);
  assert.throws(() => q.configure({ maxActive: 0 }));
  second.release();
  (await third).release();
});

test("throwing UI callback does not leak an account or a slot", async () => {
  const q = createAdmission(clock());
  q.configure({ maxActive: 1 });
  const first = await q.acquire(1);
  const second = q.acquire(2, {
    onPosition() {
      throw new Error("closed socket");
    },
  });
  first.release();
  (await second).release();
  assert.equal(q.snapshot().active, 0);
});

test("increasing the limit admits waiting work immediately without exceeding it", async () => {
  const q = createAdmission(clock());
  q.configure({ maxActive: 1 });
  const first = await q.acquire(1);
  const second = q.acquire(2),
    third = q.acquire(3);
  q.configure({ maxActive: 2 });
  const secondLease = await second;
  assert.equal(q.snapshot().active, 2);
  assert.equal(q.snapshot().waiting, 1);
  first.release();
  (await third).release();
  secondLease.release();
});

test("completion clears its timeout so an old timer cannot cancel replacement work", async () => {
  const timer = clock(),
    q = createAdmission(timer);
  const first = await q.acquire(1);
  timer.tick(1000);
  first.release();
  const second = await q.acquire(1);
  timer.tick(89000);
  assert.equal(second.signal.aborted, false);
  assert.equal(q.snapshot().active, 1);
  second.release();
});

test("a failing fake generation releases in finally and next user can run", async () => {
  const q = createAdmission(clock());
  q.configure({ maxActive: 1 });
  async function generate(userId, work) {
    const lease = await q.acquire(userId);
    try {
      return await work(lease.signal);
    } finally {
      lease.release();
    }
  }
  await assert.rejects(
    generate(1, async () => {
      throw new Error("fake provider failure");
    })
  );
  assert.equal(q.snapshot().active, 0);
  assert.equal(await generate(2, async () => "answer"), "answer");
});

test("waiting for 29 seconds still leaves a full 90 seconds after admission", async () => {
  const timer = clock(), q = createAdmission(timer);
  q.configure({ maxActive: 1 });
  const first = await q.acquire(1);
  const pending = q.acquire(2);
  timer.tick(29000);
  first.release();
  const second = await pending;
  timer.tick(89999);
  assert.equal(second.signal.aborted, false);
  timer.tick(1);
  assert.equal(second.signal.reason.code, "SCHAT_GENERATION_TIMEOUT");
  assert.equal(q.snapshot().active, 0);
});
