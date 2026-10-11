const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { UpdateGuard } = require('../../utils/documentUpdates/guard');

test('exclusive update blocks other instances and preserves durable recovery lock', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'schat-update-guard-'));
  try {
    const a = new UpdateGuard(root), b = new UpdateGuard(root);
    const release = await a.acquire('job-one');
    await assert.rejects(b.read(async () => 'unsafe'), /DOCUMENT_UPDATE_LOCKED/);
    await assert.rejects(b.acquire('job-two'), /DOCUMENT_UPDATE_LOCKED/);
    await release();
    assert.equal(await b.read(async () => 'safe'), 'safe');
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('an active read or write prevents exclusive cutover and does not leave a lock', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'schat-update-guard-'));
  try {
    const a = new UpdateGuard(root);
    let finish;
    const pending = a.read(() => new Promise(resolve => { finish = resolve; }));
    while (!finish) await new Promise(resolve => setImmediate(resolve));
    await assert.rejects(a.acquire('job-one'), /DOCUMENT_UPDATE_BUSY/);
    finish('old');
    assert.equal(await pending, 'old');
    const release = await a.acquire('job-two');
    await release();
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
