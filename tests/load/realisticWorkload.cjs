// Test-only workload. The caller supplies an isolated, authenticated app adapter.
// No URL, credentials, provider or production mode is configured here.
const {setTimeout: delay} = require('node:timers/promises');

async function runRealistic({accounts, rounds = 3, request, random = Math.random,
  sleep = delay, onResult = () => {}} = {}) {
  if (!Array.isArray(accounts) || !accounts.length || new Set(accounts).size !== accounts.length)
    throw Error('accounts must be nonempty and unique');
  if (!Number.isInteger(rounds) || rounds < 1) throw Error('rounds must be positive');
  if (typeof request !== 'function') throw Error('isolated request adapter required');
  const rows = [];
  await Promise.all(accounts.map(async account => {
    for (let round = 0; round < rounds; round++) {
      const started = performance.now();
      const result = await request(account, round);
      const row = {...result, elapsedMs: performance.now() - started,
        round, phase: round === 0 ? 'initial' : 'repeat'};
      // Do not persist account credentials or identities in result rows.
      rows.push(row); onResult(row);
      if (round + 1 < rounds) {
        const sample = random();
        if (!Number.isFinite(sample) || sample < 0 || sample >= 1) throw Error('random outside [0,1)');
        await sleep(60000 + Math.floor(sample * 120001));
      }
    }
  }));
  return rows;
}

function summarize(rows) {
  const codes = {};
  for (const row of rows) codes[row.code] = (codes[row.code] || 0) + 1;
  const admitted = rows.filter(row => row.code === 'OK' || row.admitted === true);
  const measured = admitted.filter(row => Number.isFinite(row.waitMs) && row.waitMs >= 0);
  const queued = measured.filter(row => row.queued === true);
  const mean = values => values.length ? values.reduce((sum, row) => sum + row.waitMs, 0) / values.length : null;
  return {attempts: rows.length, codes,
    fullPercent: rows.length ? (codes.SCHAT_QUEUE_FULL || 0) / rows.length * 100 : null,
    timeoutPercent: rows.length ? (codes.SCHAT_QUEUE_TIMEOUT || 0) / rows.length * 100 : null,
    meanAdmittedWaitMs: mean(measured), meanQueuedAdmittedWaitMs: mean(queued),
    measuredAdmitted: measured.length, unmeasuredAdmitted: admitted.length - measured.length};
}
module.exports = {runRealistic, summarize};
