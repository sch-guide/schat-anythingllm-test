const test = require("node:test");
const assert = require("node:assert/strict");
const { createDailyUsage, countingFetch, quotaDay } = require("../../utils/geminiDailyUsage");

test("quota day follows Pacific midnight in both summer and winter", () => {
  assert.equal(quotaDay(new Date("2026-10-10T06:59:59Z")), "2026-10-09");
  assert.equal(quotaDay(new Date("2026-10-10T07:00:00Z")), "2026-10-10");
  assert.equal(quotaDay(new Date("2026-12-10T07:59:59Z")), "2026-12-09");
  assert.equal(quotaDay(new Date("2026-12-10T08:00:00Z")), "2026-12-10");
});
test("concurrent attempts persist independently by model and survive restart", async () => {
  let saved = null, now = new Date("2026-10-10T07:10:00Z");
  const store = { read: async () => saved, write: async value => { saved = structuredClone(value); } };
  const usage = createDailyUsage(store, () => now);
  await Promise.all(Array.from({length: 20}, () => usage.record("answer")));
  await usage.record("other");
  assert.equal((await usage.snapshot("answer")).count, 20);
  const restarted = createDailyUsage(store, () => now);
  assert.equal((await restarted.snapshot("answer")).count, 20);
  now = new Date("2026-10-11T07:00:00Z");
  assert.equal((await restarted.snapshot("answer")).count, 0);
  await restarted.record("answer");
  assert.equal((await restarted.snapshot("answer")).count, 1);
});
test("warning is based on local attempts, never a provider quota block", async () => {
  const now = new Date("2026-10-10T08:00:00Z");
  let saved = { day: "2026-10-10", startedAt: now.toISOString(), counts: { answer: 6999 } };
  const usage = createDailyUsage({read: async () => saved, write: async v => {saved = v;}}, () => now);
  assert.equal((await usage.snapshot("answer")).warning, false);
  await usage.record("answer");
  assert.equal((await usage.snapshot("answer")).warning, true);
  assert.equal((await usage.snapshot("answer")).limit, 10000);
});
test("fetch boundary counts retries and failures, but not embeddings or already cancelled calls", async () => {
  let saved = null, sent = 0;
  const usage = createDailyUsage({read: async () => saved, write: async v => {saved = v;}});
  const send = countingFetch(async () => { sent++; return {status: 429}; }, usage);
  const url = "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions";
  const init = {method: "POST", body: JSON.stringify({model: "answer", messages: []})};
  await send(url, init);
  await send(url, init);
  await send(url.replace("chat/completions", "embeddings"), init);
  const signal = AbortSignal.abort();
  await assert.rejects(send(url, {...init, signal}));
  assert.equal(sent, 3);
  assert.equal((await usage.snapshot("answer")).count, 2);
});
test("telemetry storage failure does not block answers or report a trustworthy zero", async () => {
  const usage = createDailyUsage({read: async () => {throw Error("offline");}, write: async () => {throw Error("offline");}});
  const send = countingFetch(async () => "fake answer", usage);
  assert.equal(await send("https://generativelanguage.googleapis.com/v1beta/openai/chat/completions", {
    method: "POST", body: JSON.stringify({model: "answer"})
  }), "fake answer");
  assert.equal((await usage.snapshot("answer")).available, false);
});

test("initial admin poll and first request share loading, without overwriting counts", async () => {
  let resolveRead, reads = 0, saved;
  const usage = createDailyUsage({
    read: () => { reads++; return new Promise(resolve => {resolveRead = resolve;}); },
    write: async value => {saved = value;}
  });
  const poll = usage.snapshot("answer");
  await Promise.resolve();
  const request = usage.record("answer");
  await Promise.resolve();
  assert.equal(reads, 1);
  resolveRead(null);
  await Promise.all([poll, request]);
  await usage.record("answer");
  assert.equal(saved.counts.answer, 2);
});

test("a stuck telemetry write never holds up the actual provider request", async () => {
  let resolveWrite, sent = false;
  const usage = createDailyUsage({read: async () => null, write: () => new Promise(resolve => {resolveWrite = resolve;})});
  const send = countingFetch(async () => {sent = true; return "answer";}, usage);
  const request = send("https://generativelanguage.googleapis.com/v1beta/openai/chat/completions", {
    method: "POST", body: JSON.stringify({model: "answer"})
  });
  for (let i = 0; i < 10; i++) await Promise.resolve();
  try { assert.equal(sent, true); } finally { resolveWrite?.(); }
  assert.equal(await request, "answer");
});
