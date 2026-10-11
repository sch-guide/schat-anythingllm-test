const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const { createAnswerCache } = require('../../utils/answerCache');
const { prepareAnswerCache } = require('../../utils/chats/answerCache');

function fixture() {
  const cache=createAnswerCache();
  const state={admissions:0,completions:0,records:[],events:[],history:[],files:[],
    documents:[{id:1,metadata:'synthetic',lastUpdatedAt:'v1'}], fail:false, cancel:false};
  const env={SCHAT_SAFETY_ENABLED:'true',LLM_PROVIDER:'gemini',EMBEDDING_ENGINE:'gemini'};
  const workspace={id:1,slug:'synthetic',chatMode:'query',chatModel:'fake-model'};
  const deps={cache,env,prisma:{workspace_chats:{findMany:async()=>state.history},
    workspace_parsed_files:{findMany:async()=>state.files},workspace_documents:{findMany:async()=>state.documents}}};
  const vector={hasNamespace:async()=>true,namespaceCount:async()=>1,
    performSimilaritySearch:async()=>({contextTexts:['synthetic evidence'],sources:[{document_name:'synthetic',page:3}],relatedImageSources:[]})};
  const connector={promptWindowLimit:()=>1000,defaultTemp:0};
  const modules={
    uuid:{v4:()=>`uuid-${state.records.length}`},
    '../DocumentManager':{DocumentManager:class {async pinnedDocs(){return [];}}},
    '../../models/workspaceChats':{WorkspaceChats:{new:async record=>{state.records.push(structuredClone(record));return{chat:{id:state.records.length}};}}},
    '../../models/workspaceParsedFiles':{WorkspaceParsedFiles:{getContextFiles:async()=>state.files}},
    '../helpers':{getVectorDbClass:()=>vector,resolveProviderConnector:async()=>({connector})},
    '../helpers/modelPricing':{addChatCostToMetrics:value=>value || {}},
    '../helpers/chat/responses':{writeResponseChunk:(_,value)=>state.events.push(structuredClone(value))},
    '../helpers/abortSignals':{abortConnectorOnClientDisconnect:()=>{}},
    '../chatAdmissionRuntime':{runtime:{ready:async()=>{state.admissions++;return {};}}},
    '../chatAdmissionSession':{openSession:async()=>{if(state.onAdmission)await state.onAdmission();return{signal:{aborted:false},check(){if(state.cancel)throw Object.assign(new Error('cancel'),{code:'SCHAT_CANCELLED'});},bind(){},release(){}};},admissionMessage:()=>''},
    '../chatAdmissionContext':{withAdmissionSignal:(_,operation)=>operation()},
    './agents':{grepAgents:async()=>false},
    './index':{grepCommand:async message=>message,VALID_COMMANDS:{},chatPrompt:async()=>'',
      recentChatHistory:async()=>({rawHistory:state.history,chatHistory:[]}),sourceIdentifier:()=> 'source'},
    './searchQueries':require('../../utils/chats/searchQueries'),
    './expandedBodySearch':{runExpandedBodySearch:async({search})=>search({})},
    '../helpers/chat':{fillSourceWindow:({searchResults})=>({contextTexts:searchResults.map(()=> 'evidence')})},
    '../schatSafety/imageAttachment':{attachmentsForChatRecord:()=>[],validateSafetyImageAttachments:value=>value},
    '../schatSafety/chat':{runSchatCompletion:async({sources})=>{state.completions++;if(state.onCompletion)await state.onCompletion();if(sources.some(source=>source.document_name==='private'))return{text:'개인 가짜답변',sources,metrics:{}};return state.fail?
      {text:'fallback',sources:[],metrics:{}}:
      {text:'가짜 답변',sources:[{document_name:'synthetic',page:3,exact_text:'가짜 원문'}],presentation:{kind:'procedure',summary:'가짜 요약',sections:[]},relatedImages:[{key:'synthetic'}],metrics:{total_tokens:9}};}},
    '../answerCacheRuntime':{cache},
    './answerCache':{prepareAnswerCache:input=>prepareAnswerCache(input,deps)},
  };
  const sandbox={module:{exports:{}},require:name=>{if(!(name in modules))throw new Error(`Unmocked dependency: ${name}`);return modules[name];},process:{env},console};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../../utils/chats/stream.js'),'utf8'),sandbox);
  async function ask(message='CT 준비?',user={id:1}) {
    const response=new EventEmitter();response.destroyed=!!state.disconnected;response.writableEnded=false;response.end=()=>{};
    await sandbox.module.exports.streamChatWithWorkspace(response,workspace,message,'query',user);
  }
  return {cache,state,ask,workspace};
}

test('cache hit bypasses admission and model while preserving fresh chat IDs, prompt, evidence and presentation',async()=>{
  const f=fixture();await f.ask();await f.ask('ct준비！',{id:2});
  assert.equal(f.state.admissions,1);assert.equal(f.state.completions,1);
  assert.equal(f.state.records.length,2);assert.equal(f.state.records[1].prompt,'ct준비！');
  assert.equal(f.state.records[1].response.sources[0].exact_text,'가짜 원문');
  assert.equal(f.state.records[1].response.presentation.summary,'가짜 요약');
  const final=f.state.events.filter(event=>event.type==='finalizeResponseStream');
  assert.deepEqual(final.map(event=>event.chatId),[1,2]);
  assert.equal(final[1].metrics.answerCacheHit,true);
  assert.equal(final[1].metrics.total_tokens,0);
  assert.equal(f.cache.stats().hits,1);
});
test('fallbacks, cancelled answers and changes during generation are never stored',async()=>{
  for(const kind of ['fail','cancel','change']) {
    const f=fixture();
    if(kind==='fail')f.state.fail=true;
    if(kind==='cancel')f.state.onCompletion=()=>{f.state.cancel=true;};
    if(kind==='change')f.state.onCompletion=()=>{const finish=f.cache.beginMutation([1]);finish();};
    await f.ask();assert.equal(f.cache.stats().entries,0,kind);
  }
});
test('history, private files, document replacement, workspace and model changes cannot reuse old answers',async()=>{
  for(const kind of ['history','files','documents','workspace','model']) {
    const f=fixture();await f.ask();
    if(kind==='history')f.state.history=[{id:99}];
    if(kind==='files')f.state.files=[{id:99,pageContent:'private'}];
    if(kind==='documents')f.state.documents[0].metadata='replacement';
    if(kind==='workspace')f.workspace.id=2;
    if(kind==='model')f.workspace.chatModel='other-fake-model';
    await f.ask();assert.equal(f.state.completions,2,kind);
  }
});
test('disconnected cache requests are not counted as saved model calls',async()=>{
  const f=fixture();await f.ask();f.state.disconnected=true;
  await f.ask();assert.equal(f.cache.stats().hits,0);assert.equal(f.state.records.length,1);
});
test('private file added while queued then deleted cannot leak a personal answer to another user',async()=>{
  const f=fixture();
  f.state.onAdmission=()=>{f.state.files=[{pageContent:'private synthetic evidence',document_name:'private'}];};
  await f.ask();
  assert.equal(f.state.records[0].response.text,'개인 가짜답변');
  assert.equal(f.cache.stats().entries,0,'a completion that consumed a private parsed file must not be cached');
  f.state.files=[];f.state.onAdmission=null;
  await f.ask('CT 준비?',{id:2});
  assert.equal(f.state.completions,2);
  assert.equal(f.state.records[1].response.text,'가짜 답변');
  assert.equal(f.cache.stats().hits,0);
});
test('history that appears while queued prevents storing a shared answer',async()=>{
  const f=fixture();f.state.onAdmission=()=>{f.state.history=[{id:99}];};
  await f.ask();assert.equal(f.cache.stats().entries,0);
});
