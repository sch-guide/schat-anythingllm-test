const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { createAdmission } = require("../../utils/chatAdmission");
const { openSession } = require("../../utils/chatAdmissionSession");

test("disconnect while waiting removes request and never starts provider", async () => {
  const gate = createAdmission();
  gate.configure({ maxActive: 1 });
  const first = await gate.acquire("one");
  const transport = new EventEmitter();
  const positions = [];
  const pending = openSession(gate, "two", transport, {
    onPosition: (n) => positions.push(n),
  });
  transport.emit("close");
  await assert.rejects(pending, { code: "SCHAT_CANCELLED" });
  assert.deepEqual(positions, [1]);
  assert.equal(gate.snapshot().waiting, 0);
  first.release();
  assert.equal(transport.listenerCount("close"), 0);
});

test("disconnect aborts bound Gemini SDK and prevents a late generation", async () => {
  const gate = createAdmission();
  const transport = new EventEmitter();
  const session = await openSession(gate, "one", transport);
  let calls = 0;
  let signal;
  const connector = {
    openai: {
      chat: {
        completions: {
          create: async (_body, opts) => {
            calls++;
            signal = opts.signal;
            return new Promise((resolve, reject) =>
              opts.signal.addEventListener(
                "abort",
                () => reject(new Error("cancelled")),
                { once: true }
              )
            );
          },
        },
      },
    },
  };
  session.bind(connector);
  const request = connector.openai.chat.completions.create({});
  transport.emit("close");
  await assert.rejects(request, /cancelled/);
  assert.equal(signal.aborted, true);
  assert.throws(() => session.check(), { code: "SCHAT_CANCELLED" });
  assert.equal(calls, 1);
  session.release();
  assert.equal(gate.snapshot().active, 0);
});

test("deadline aborts Agent before allowing another request and cleans listeners", async () => {
  const timers = new Map();
  let id = 0;
  const gate = createAdmission({
    setTimer: (fn, ms) => {
      timers.set(++id, { fn, ms });
      return id;
    },
    clearTimer: (id) => timers.delete(id),
  });
  gate.configure({ maxActive: 1 });
  const transport = new EventEmitter();
  const order = [];
  const session = await openSession(gate, "one", transport, {
    onAbort: (reason) => order.push(reason.code),
  });
  const next = gate.acquire("two").then((lease) => {
    order.push("next");
    return lease;
  });
  [...timers.values()].find((t) => t.ms === 90000).fn();
  const lease = await next;
  assert.deepEqual(order, ["SCHAT_GENERATION_TIMEOUT", "next"]);
  session.release();
  lease.release();
  assert.equal(transport.listenerCount("close"), 0);
  assert.equal(gate.snapshot().active, 0);
});

test("already closed transport cannot claim a slot", async () => {
  const transport = new EventEmitter();
  transport.destroyed = true;
  const gate = createAdmission();
  await assert.rejects(openSession(gate, "one", transport), {
    code: "SCHAT_CANCELLED",
  });
  assert.equal(gate.snapshot().active, 0);
});
