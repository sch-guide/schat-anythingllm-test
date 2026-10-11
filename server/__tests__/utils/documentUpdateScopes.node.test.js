const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { UpdateGuard } = require('../../utils/documentUpdates/guard');
const { createScopedOperations, documentKey } = require('../../utils/documentUpdates/scopes');

test('same document conflicts but another document in the same workspace continues', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'schat-scope-test-'));
  const guard = new UpdateGuard(root);
  const operations = createScopedOperations(guard);
  const release = await guard.acquire('test-job', [documentKey('가상검사.PDF')]);
  try {
    await assert.rejects(operations.document(1, ['가상검사.pdf'], async () => {}), /DOCUMENT_UPDATE_LOCKED/);
    assert.equal(await operations.document(1, ['다른검사.pdf'], async () => 'ok'), 'ok');
    assert.equal(await operations.reset(2, 'other-reset', async () => 'ok'), 'ok');
  } finally { await release(); }
  assert.equal(await operations.document(1, ['가상검사.pdf'], async () => 'released'), 'released');
});

test('workspace reset cannot cross an active document write; another workspace can reset', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'schat-scope-test-'));
  const operations = createScopedOperations(new UpdateGuard(root));
  let entered, finish;
  const started = new Promise(resolve => { entered = resolve; });
  const gate = new Promise(resolve => { finish = resolve; });
  const writing = operations.document(1, ['검사.pdf'], async () => { entered(); await gate; });
  await started;
  try {
    await assert.rejects(operations.reset(1, 'reset', async () => {}), /DOCUMENT_UPDATE_BUSY/);
    assert.equal(await operations.reset(2, 'other', async () => 'ok'), 'ok');
  } finally { finish(); await writing; }
  assert.equal(await operations.reset(1, 'reset', async () => 'ok'), 'ok');
});

test('failed ordinary work releases its lease and folder/case variants share a name', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'schat-scope-test-'));
  const operations = createScopedOperations(new UpdateGuard(root));
  assert.equal(documentKey('folder/검사.PDF'), documentKey('검사.pdf'));
  await assert.rejects(operations.document(1, ['검사.pdf'], async () => { throw new Error('synthetic'); }), /synthetic/);
  assert.equal(await operations.reset(1, 'reset', async () => 'free'), 'free');
  await assert.rejects(operations.reset(1, 'failed-reset', async () => { throw new Error('synthetic reset failure'); }), /synthetic reset failure/);
  assert.equal(await operations.reset(1, 'retry-reset', async () => 'free'), 'free');
});
