const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { updateDestination } = require('../utils/documentUpdateStage');
test('update files can only be prepared outside the live document catalog', () => {
  const folder = path.resolve('example-storage/documents');
  assert.equal(updateDestination(folder, '3a21345e-7508-4482-ae03-267643eaa709'),
    path.resolve('example-storage/document-updates/3a21345e-7508-4482-ae03-267643eaa709/documents'));
  for (const invalid of ['../documents', 'abc', '/', ''])
    assert.throws(() => updateDestination(folder, invalid), /INVALID_DOCUMENT_UPDATE_JOB/);
});
