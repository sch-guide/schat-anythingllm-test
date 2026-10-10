const test = require('node:test');
const assert = require('node:assert/strict');
const { createHarness, request } = require('./admissionHarness.cjs');
test('HTTP duplicate, queue order and disconnect use the real admission module', async () => {
  const app = await createHarness({ delayMs: 100, maxActive: 1 });
  try {
    const first = request(app.port, 1);
    while (app.gate.snapshot().active === 0) await new Promise(r => setTimeout(r, 1));
    assert.equal((await request(app.port, 1)).code, 'SCHAT_DUPLICATE');
    const second = request(app.port, 2);
    assert.equal((await first).code, 'OK');
    assert.ok((await second).positions.includes(1));
    assert.equal((await request(app.port, 3, 10)).code, 'CLIENT_CANCELLED');
    await new Promise(r => setTimeout(r, 20));
    assert.equal(app.gate.snapshot().active, 0);
    assert.equal(app.gate.snapshot().waiting, 0);
  } finally { await app.close(); }
});
test('only synthetic identities 1 through 50 are accepted', async () => {
  const app = await createHarness({delayMs: 1});
  try {
    assert.equal((await request(app.port, 51)).code, 'UNAUTHORIZED');
    assert.equal(app.gate.snapshot().active, 0);
  } finally { await app.close(); }
});
