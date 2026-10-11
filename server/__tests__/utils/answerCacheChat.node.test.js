const test = require('node:test');
const assert = require('node:assert/strict');
const { createAnswerCache } = require('../../utils/answerCache');
const { prepareAnswerCache } = require('../../utils/chats/answerCache');

function fixture() {
  const cache = createAnswerCache();
  const state = { history: [], files: [], documents: [{id:1,metadata:'{"document_id":"synthetic"}',lastUpdatedAt:'v1'}] };
  const deps = {cache, env:{LLM_PROVIDER:'gemini',EMBEDDING_ENGINE:'gemini',SCHAT_SAFETY_ENABLED:'true'}, model:()=> 'fake-model',
    prisma: {workspace_chats:{findMany:async()=>state.history},workspace_parsed_files:{findMany:async()=>state.files},workspace_documents:{findMany:async()=>state.documents}}};
  const input = {workspace:{id:1,slug:'synthetic',chatMode:'query',openAiPrompt:'fake-prompt'},message:'CT 준비?',updatedMessage:'CT 준비?',chatMode:'query',user:{id:1},attachments:[]};
  return {cache,state,deps,input};
}
test('safe standalone grounded question can reuse full evidence with a fresh question spelling',async()=>{
  const {cache,deps,input}=fixture();
  const prepared=await prepareAnswerCache(input,deps);
  assert.ok(prepared);
  cache.put({...prepared,question:input.message,value:{answer:'가짜 답변',sources:[{page:3,document_name:'synthetic'}]}});
  const next=await prepareAnswerCache({...input,message:'ct준비！',updatedMessage:'ct준비！',user:{id:2}},deps);
  assert.equal(cache.get(1,'ct준비！',next.context).answer,'가짜 답변');
});
test('history, parsed files, attachments, commands, agents and personalized modes bypass reuse',async()=>{
  for(const change of [
    {message:'/preset',updatedMessage:'expanded'}, {message:'@agent CT?',updatedMessage:'@agent CT?'},
    {message:'CT /custom',updatedMessage:'CT /custom'}, {attachments:[{type:'synthetic'}]},
    {chatMode:'automatic'}, {workspace:{id:1,chatMode:'automatic'}},
  ]) {
    const f=fixture();
    assert.equal(await prepareAnswerCache({...f.input,...change},f.deps),null,JSON.stringify(change));
  }
  for(const kind of ['history','files']) {
    const f=fixture(); f.state[kind]=[{id:1}];
    assert.equal(await prepareAnswerCache(f.input,f.deps),null,kind);
  }
  const f=fixture();f.deps.env.SCHAT_SAFETY_ENABLED='false';
  assert.equal(await prepareAnswerCache(f.input,f.deps),null);
  f.deps.env.SCHAT_SAFETY_ENABLED='true';f.input.workspace.chatProvider='anythingllm-router';
  assert.equal(await prepareAnswerCache(f.input,f.deps),null);
});
test('failed state checks fail closed and changed document fingerprint cannot hit old answers',async()=>{
  const f=fixture();const prepared=await prepareAnswerCache(f.input,f.deps);
  f.cache.put({...prepared,question:'CT 준비?',value:{answer:'old'}});
  f.state.documents[0].metadata='{"document_id":"new"}';
  const next=await prepareAnswerCache(f.input,f.deps);
  assert.equal(f.cache.get(1,'CT 준비?',next.context),null);
  f.deps.prisma.workspace_chats.findMany=async()=>{throw new Error('synthetic failure');};
  assert.equal(await prepareAnswerCache(f.input,f.deps),null);
});

test('normal chat reuses only the first question and keeps query mode separate',async()=>{
  const f=fixture();f.input.chatMode='chat';f.input.workspace.chatMode='chat';
  const prepared=await prepareAnswerCache(f.input,f.deps);
  assert.ok(prepared);
  f.cache.put({...prepared,question:f.input.message,value:{answer:'shared first answer'}});
  const next=await prepareAnswerCache({...f.input,user:{id:2},thread:{id:20}},f.deps);
  assert.equal(f.cache.get(1,f.input.message,next.context).answer,'shared first answer');
  const query=await prepareAnswerCache({...f.input,chatMode:'query'},f.deps);
  assert.equal(f.cache.get(1,f.input.message,query.context),null);
  f.state.history=[{id:99}];
  assert.equal(await prepareAnswerCache(f.input,f.deps),null);
});
test('watched corpus and a mutation during eligibility checks cannot be reused',async()=>{
  const f=fixture();f.state.documents[0].watched=true;
  assert.equal(await prepareAnswerCache(f.input,f.deps),null);
  f.state.documents[0].watched=false;
  f.deps.prisma.workspace_documents.findMany=async()=>{
    const finish=f.cache.beginMutation([1]);finish();return f.state.documents;
  };
  assert.equal(await prepareAnswerCache(f.input,f.deps),null);
});
test('native or unconfigured embedding bypasses reuse while explicit Gemini remains eligible',async()=>{
  for(const engine of [undefined,'','native']) {
    const f=fixture();
    if(engine===undefined)delete f.deps.env.EMBEDDING_ENGINE;
    else f.deps.env.EMBEDDING_ENGINE=engine;
    assert.equal(await prepareAnswerCache(f.input,f.deps),null,String(engine));
  }
  const f=fixture();assert.ok(await prepareAnswerCache(f.input,f.deps));
});
