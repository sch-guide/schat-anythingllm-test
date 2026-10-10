const {test} = require('node:test');
const assert = require('node:assert/strict');
const {createFakeFetch} = require('./fakeGemini.cjs');
const base = 'https://generativelanguage.googleapis.com/v1beta/openai/';

test('synthetic failure marker returns a provider error without a real call', async()=>{
  const response=await createFakeFetch(1)(base+'chat/completions',{body:JSON.stringify({messages:[{role:'user',content:'SCHAT_SYNTHETIC_FAILURE'}]})});
  assert.equal(response.status,400);
});
test('embeddings preserve batch count; streaming produces complete SDK SSE', async () => {
  const fetch = createFakeFetch(1);
  const embedded = await (await fetch(base+'embeddings',{body:JSON.stringify({input:['a','b']})})).json();
  assert.equal(embedded.data.length,2);
  const stream = await fetch(base+'chat/completions',{body:JSON.stringify({model:'fake',stream:true,messages:[]})});
  const text = await stream.text();
  assert.match(text,/Synthetic fixed answer/);
  assert.match(text,/data: \[DONE\]/);
});
test('SDK default base64 embedding decodes to three floats', async () => {
  const response = await createFakeFetch(1)(base+'embeddings', {body:JSON.stringify({input:['a'],encoding_format:'base64'})});
  const value = (await response.json()).data[0].embedding;
  assert.equal(typeof value, 'string');
  const bytes = Buffer.from(value, 'base64');
  assert.equal(bytes.length, 12);
  assert.deepEqual([0,4,8].map(offset=>bytes.readFloatLE(offset)), [1,0,0]);
});
test('cancellation and unknown destinations fail closed', async () => {
  const fetch = createFakeFetch(1000); const controller = new AbortController();
  const pending = fetch(base+'chat/completions',{body:'{}',signal:controller.signal});
  controller.abort();
  await assert.rejects(pending,{name:'AbortError'});
  await assert.rejects(fetch('https://example.com',{}),/Unexpected/);
});
