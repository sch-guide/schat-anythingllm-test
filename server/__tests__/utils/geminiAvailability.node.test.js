const test = require('node:test');
const assert = require('node:assert/strict');
const { classify, createMonitor } = require('../../utils/geminiAvailability');
const quota = (id) => ({status:429,error:{status:'RESOURCE_EXHAUSTED',details:[{'@type':'type.googleapis.com/google.rpc.QuotaFailure',violations:[{quotaId:id}]}]}});
for (const [id,expected] of [['GenerateRequestsPerDayPerModel','exhausted'],['GenerateTokensPerMinute','busy']]) {
  test(id, () => assert.equal(classify(quota(id)), expected));
}
test('ambiguous 429 and billing advice do not prove exhaustion', () => {
  assert.equal(classify({status:429,message:'Quota exceeded; check your plan and billing details'}),'other');
  assert.equal(classify({status:401,message:'invalid key'}),'other');
});
test('explicit depleted balance and temporary spend window differ', () => {
  assert.equal(classify({status:429,message:'Prepaid balance exhausted'}),'exhausted');
  assert.equal(classify({status:429,message:'Spend rate limit per 10 minutes exceeded'}),'busy');
});
test('daily limit takes precedence over minute limit', () => {
  const error=quota('PerMinute'); error.error.details[0].violations.push({quotaId:'PerDay'});
  assert.equal(classify(error),'exhausted');
});
test('first timestamp persists; unrelated success does not clear; next matching success does', async () => {
  let time=1000; const monitor=createMonitor(()=>time);
  const fail=monitor.wrap(async()=>{throw quota('PerDay')},'generation:model-a');
  await assert.rejects(fail(), /간호교육파트 내선번호 : 6741/);
  time=2000; await assert.rejects(fail());
  assert.equal(monitor.snapshot()[0].firstOccurredAt,'1970-01-01T00:00:01.000Z');
  await monitor.wrap(async()=>({choices:[{}]}),'generation:model-b')();
  assert.equal(monitor.snapshot().length,1);
  await monitor.wrap(async()=>({choices:[{}]}),'generation:model-a')();
  assert.equal(monitor.snapshot().length,0);
});
test('in-flight older success cannot erase a newer outage',async()=>{
  const monitor=createMonitor(); let resolve;
  const pending=monitor.wrap(()=>new Promise(r=>resolve=r),'a')();
  await assert.rejects(monitor.wrap(async()=>{throw quota('PerDay')},'a')());
  resolve({choices:[{}]}); await pending;
  assert.equal(monitor.snapshot().length,1);
});
test('stream failure is classified; only a completed stream clears warning',async()=>{
  const monitor=createMonitor();
  const failed=await monitor.wrap(async()=>({async *[Symbol.asyncIterator](){yield {choices:[]};throw quota('PerDay')}}),'a')();
  await assert.rejects(async()=>{for await(const _ of failed){}},/사용량이 소진/);
  const incomplete=await monitor.wrap(async()=>({async *[Symbol.asyncIterator](){yield {choices:[]}}}),'a')();
  for await(const _ of incomplete){}
  assert.equal(monitor.snapshot().length,1);
  const completed=await monitor.wrap(async()=>({async *[Symbol.asyncIterator](){yield {choices:[{finish_reason:'stop'}]}}}),'a')();
  for await(const _ of completed){}
  assert.equal(monitor.snapshot().length,0);
});
test('busy/other errors expose no raw secret and never create exhaustion banner',async()=>{
  const monitor=createMonitor();
  await assert.rejects(monitor.wrap(async()=>{throw quota('PerMinute')},'a')(),/사용자가 많아 잠시 후 다시 시도해 주세요/);
  await assert.rejects(monitor.wrap(async()=>{throw {status:500,message:'secret patient content'}} ,'a')(),e=>!e.message.includes('secret'));
  assert.deepEqual(monitor.snapshot(),[]);
});
test('wrapper forwards exact arguments without changing retrieval or model input',async()=>{
  const monitor=createMonitor();const input={model:'unchanged',messages:[{content:'synthetic'}]};
  const output={data:[{embedding:[1]}]};
  const result=await monitor.wrap(async(...args)=>{assert.equal(args[0],input);return output},'embed') (input);
  assert.equal(result,output);
});
test('consumer stopping at the final frame still clears; cancellation remains cancellation', async()=>{
  const monitor=createMonitor();
  await assert.rejects(monitor.wrap(async()=>{throw quota('PerDay')},'a')());
  const stream=await monitor.wrap(async()=>({async *[Symbol.asyncIterator](){yield {choices:[{finish_reason:'stop'}]}}}),'a')();
  for await(const _ of stream){break;}
  assert.equal(monitor.snapshot().length,0);
  const aborted=Object.assign(new Error('cancelled'),{name:'AbortError'});
  await assert.rejects(monitor.wrap(async()=>{throw aborted},'a')(),error=>error===aborted);
});
test('safe errors retain SDK error type needed by existing agent retry policy',async()=>{
  class RateLimitError extends Error {}
  const original=Object.assign(new RateLimitError('PerMinute secret'),{status:429});
  await assert.rejects(createMonitor().wrap(async()=>{throw original},'a')(), error=>{
    assert.ok(error instanceof RateLimitError);
    assert.equal(error.schatGeminiKind,'busy');
    assert.equal(error.status,429);
    assert.ok(!error.message.includes('secret'));
    return true;
  });
});
