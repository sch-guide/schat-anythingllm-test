const {test} = require('node:test');
const assert = require('node:assert/strict');
const {requestChat} = require('./appRequest.cjs');
const {requestAgent} = require('./appAgentRequest.cjs');
test('adapters refuse host execution before any HTTP request', async () => {
  if (process.env.SCHAT_ISOLATED_APP_TEST === 'explicit-local-only') return;
  const original = globalThis.fetch;
  let called = false;
  globalThis.fetch = async () => { called = true; throw Error('Must not fetch'); };
  try {
    await assert.rejects(requestChat('not-a-token'), /Docker|required|forbidden/);
    await assert.rejects(requestAgent('not-a-token'), /Docker|required|forbidden/);
    assert.equal(called, false);
  } finally {globalThis.fetch = original;}
});
