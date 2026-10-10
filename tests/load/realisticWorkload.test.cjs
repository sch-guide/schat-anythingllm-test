const {test} = require('node:test');
const assert = require('node:assert/strict');
const {runRealistic, summarize} = require('./realisticWorkload.cjs');

test('each account waits after its answer and before the next question', async () => {
  const events = [];
  const rows = await runRealistic({accounts: ['a'], rounds: 3, random: () => 0.5,
    request: async (account) => { events.push(account); return {code: 'OK', waitMs: 0}; },
    sleep: async ms => events.push(ms)});
  assert.deepEqual(events, ['a', 120000, 'a', 120000, 'a']);
  assert.deepEqual(rows.map(row => row.phase), ['initial', 'repeat', 'repeat']);
});

test('50 independent accounts never overlap their own questions', async () => {
  const active = new Set(); let peak = 0;
  const rows = await runRealistic({accounts: Array.from({length: 50}, (_, i) => i + 1),
    rounds: 2, random: () => 0,
    sleep: async ms => assert.equal(ms, 60000),
    request: async account => {
      assert.equal(active.has(account), false); active.add(account); peak = Math.max(peak, active.size);
      await new Promise(resolve => setImmediate(resolve)); active.delete(account);
      return {code: 'OK', waitMs: 10};
    }});
  assert.equal(peak, 50); assert.equal(rows.length, 100); assert.equal(active.size, 0);
});

test('rejection denominator includes all attempts; missing waits are not zero', () => {
  const result = summarize([
    {code: 'OK', waitMs: 0, queued: false},
    {code: 'OK', waitMs: 2000, queued: true},
    {code: 'SCHAT_QUEUE_FULL'}, {code: 'SCHAT_QUEUE_TIMEOUT', waitMs: 30000},
    {code: 'CLIENT_CANCELLED'},
  ]);
  assert.equal(result.attempts, 5);
  assert.equal(result.fullPercent, 20);
  assert.equal(result.timeoutPercent, 20);
  assert.equal(result.meanAdmittedWaitMs, 1000);
  assert.equal(result.meanQueuedAdmittedWaitMs, 2000);
  assert.equal(result.unmeasuredAdmitted, 0);
  assert.equal(summarize([{code: 'OK'}]).meanAdmittedWaitMs, null);
  assert.equal(summarize([{code: 'OK'}]).unmeasuredAdmitted, 1);
  assert.equal(summarize([]).fullPercent, null);
});

test('a rejected user backs off too, rather than becoming a tight retry loop', async () => {
  const waits = [];
  await runRealistic({accounts: ['a'], rounds: 2, random: () => 1 - Number.EPSILON,
    request: async () => ({code: 'SCHAT_QUEUE_FULL'}), sleep: async ms => waits.push(ms)});
  assert.deepEqual(waits, [180000]);
});

test('rejects duplicate account identities and invalid rounds', async () => {
  await assert.rejects(runRealistic({accounts: ['a', 'a'], rounds: 2}), /unique/);
  await assert.rejects(runRealistic({accounts: ['a'], rounds: 0}), /rounds/);
});
