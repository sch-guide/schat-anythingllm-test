const test = require('node:test');
const assert = require('node:assert/strict');
const { replacePreparedDocument } = require('../../utils/documentUpdates/transaction');

function fixture(fail) {
  const state = { old: true, fresh: false, archived: false, linked: ['checklist:1'], blocked: false };
  return { state, adapter: {
    async prepare() { if (fail === 'prepare') throw Error('prepare'); return 'prepared'; },
    async lock() { state.blocked = true; },
    async snapshot() { return structuredClone(state); },
    async install() { state.fresh = true; },
    async retire() { state.old = false; if (fail === 'retire') throw Error('retire'); },
    async verify() { assert.equal(state.old, false); assert.equal(state.fresh, true); },
    async archive() { state.archived = true; return { linked: state.linked }; },
    async restore(snapshot) { Object.assign(state, snapshot); },
    async unlock() { state.blocked = false; },
    async cleanup() {},
  }};
}
test('successful replacement removes old search data but preserves linked items', async () => {
  const {state,adapter} = fixture();
  assert.deepEqual(await replacePreparedDocument(adapter), {linked:['checklist:1']});
  assert.deepEqual(state, {old:false,fresh:true,archived:true,linked:['checklist:1'],blocked:false});
});
test('preparation failure never changes existing data', async () => {
  const {state,adapter} = fixture('prepare');
  await assert.rejects(replacePreparedDocument(adapter), /prepare/);
  assert.equal(state.old,true); assert.equal(state.blocked,false); assert.equal(state.fresh,false);
});
test('failure during retirement restores previous search state', async () => {
  const {state,adapter} = fixture('retire');
  await assert.rejects(replacePreparedDocument(adapter), /retire/);
  assert.equal(state.old,true); assert.equal(state.fresh,false); assert.equal(state.blocked,false);
});
test('failed restoration leaves searches blocked rather than mixing versions', async () => {
  const {state,adapter} = fixture('retire');
  adapter.restore = async () => { throw Error('restore'); };
  await assert.rejects(replacePreparedDocument(adapter));
  assert.equal(state.blocked,true);
});

test('lock refusal releases only the prepared temporary data, never someone else\'s lock', async () => {
  const { adapter, state } = fixture();
  let staged = true;
  adapter.lock = async () => { throw Error('busy'); };
  adapter.cleanup = async () => { staged = false; };
  adapter.unlock = async () => { assert.fail('must not release an unowned lock'); };
  await assert.rejects(replacePreparedDocument(adapter), /busy/);
  assert.equal(staged, false);
  assert.equal(state.old, true);
});

test('failed rollback preserves recovery materials and both failure causes', async () => {
  const { adapter, state } = fixture('retire');
  let recoveryMaterials = true;
  adapter.restore = async () => { throw Error('restore'); };
  adapter.cleanup = async () => { recoveryMaterials = false; };
  await assert.rejects(replacePreparedDocument(adapter), error => {
    assert.equal(error instanceof AggregateError, true);
    assert.deepEqual(error.errors.map(item => item.message), ['retire', 'restore']);
    return true;
  });
  assert.equal(recoveryMaterials, true);
  assert.equal(state.blocked, true);
});

test('cleanup failure after a verified replacement reports success with a warning, not a retryable replacement error', async () => {
  const { adapter, state } = fixture();
  adapter.cleanup = async () => { throw Error('temporary cleanup failed'); };
  const result = await replacePreparedDocument(adapter);
  assert.deepEqual(result.linked, ['checklist:1']);
  assert.deepEqual(result.warnings, ['TEMPORARY_CLEANUP_PENDING']);
  assert.equal(state.old, false);
  assert.equal(state.blocked, false);
});

test('snapshot failure does not attempt installation or restoration', async () => {
  const { adapter, state } = fixture();
  adapter.snapshot = async () => { throw Error('snapshot'); };
  adapter.restore = async () => { assert.fail('no snapshot to restore'); };
  await assert.rejects(replacePreparedDocument(adapter), /snapshot/);
  assert.equal(state.old, true);
  assert.equal(state.fresh, false);
  assert.equal(state.blocked, false);
});

test('unlock failure retains recovery data after successful replacement', async () => {
  const { adapter, state } = fixture();
  let recoveryMaterials = true;
  adapter.unlock = async () => { throw Error('unlock'); };
  adapter.cleanup = async () => { recoveryMaterials = false; };
  await assert.rejects(replacePreparedDocument(adapter), /DOCUMENT_UPDATE_UNLOCK_REQUIRED/);
  assert.equal(state.blocked, true);
  assert.equal(recoveryMaterials, true);
});
