const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const moduleUnderTest = { exports: {} };
vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, '../../utils/helpers/chat/responses.js'), 'utf8'), {
  module: moduleUnderTest, console,
  require: (name) => name === 'uuid' ? { v4: () => 'test' } : name === 'moment' ? () => {} : {},
});
const { writeResponseChunk } = moduleUnderTest.exports;
function response() {
  const res = new EventEmitter();
  res.chunks = [];
  res.write = data => res.chunks.push(JSON.parse(data.slice(6)));
  return res;
}
test('완료한 답변 뒤 기록 실패가 답변 오류로 바뀌지 않음', () => {
  const res = response();
  writeResponseChunk(res, { uuid: 'a', type: 'textResponseChunk', textResponse: '시험 답변', close: true, error: false });
  writeResponseChunk(res, { type: 'abort', error: 'fake save failure', close: true });
  assert.equal(res.chunks.length, 1);
});
test('완료 이벤트는 부분 답변에서는 발생하지 않고 마지막 조각에서 한 번 발생함', () => {
  const res = response();
  let complete = 0;
  res.on('schat:answer-complete', () => complete++);
  writeResponseChunk(res, { type: 'textResponseChunk', textResponse: '일부', close: false });
  assert.equal(complete, 0);
  writeResponseChunk(res, { type: 'textResponseChunk', textResponse: '', close: true, error: false });
  writeResponseChunk(res, { type: 'finalizeResponseStream', chatId: 1, close: true, error: false });
  assert.equal(complete, 1);
  assert.equal(res.chunks.at(-1).chatId, 1);
});
test('부분 답변 뒤 실제 실패는 숨기지 않음', () => {
  const res = response();
  writeResponseChunk(res, { type: 'textResponseChunk', textResponse: '일부', close: false });
  writeResponseChunk(res, { type: 'abort', error: 'fake timeout', close: true });
  assert.equal(res.chunks.at(-1).type, 'abort');
});
