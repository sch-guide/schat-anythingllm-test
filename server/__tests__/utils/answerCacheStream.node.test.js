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
    performSimilaritySearch:async()=>{if(state.onSearch)await state.onSearch();return {contextTexts:['synthetic evidence'],sources:[{document_name:'synthetic',page:3}],relatedImageSources:[]};}};
  const connector={promptWindowLimit:()=>1000,defaultTemp:0};
  const modules={
    '../agents/aibitat/utils/sheetDepartmentContacts':{departmentContactTarget:require('../../utils/agents/aibitat/utils/sheetDepartmentContacts').departmentContactTarget,resolveWorkspaceDepartmentContact:async()=>state.contact||null},
    uuid:{v4:()=>`uuid-${state.records.length}`},
    '../DocumentManager':{DocumentManager:class {async pinnedDocs(){if(state.onPins)await state.onPins();return [];}}},
    '../documentUpdates/searchSnapshot':{withSearchSnapshot:(_workspace,operation)=>state.withSnapshot?state.withSnapshot(operation):operation(),filterArchivedHistory:async(_workspace,history)=>history},
    '../../models/workspaceChats':{WorkspaceChats:{new:async record=>{if(state.onSave)return state.onSave(record);state.records.push(structuredClone(record));return{chat:{id:state.records.length}};}}},
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
  async function ask(message='CT 준비?',user={id:1},mode='query') {
    const response=new EventEmitter();response.destroyed=!!state.disconnected;response.writableEnded=false;response.end=()=>{};
    await sandbox.module.exports.streamChatWithWorkspace(response,workspace,message,mode,user);
  }
  return {cache,state,ask,workspace};
}

test('전담 연락처는 모델 호출 없이 전체 명단과 근거를 전달하고 성공으로 기록',async()=>{
  const f=fixture();
  f.state.contact={text:'가상내과 전담간호사 단축번호입니다.\n- 가나다: 1234\n- 라마바: 5678',source:{document_name:'가상.xlsx',evidenceQuotes:['합성 근거 1','합성 근거 2']}};
  await f.ask('가상 전담번호');
  assert.equal(f.state.completions,0);
  assert.equal(f.state.records.length,1);
  assert.equal(f.state.records[0].response.searchOutcome.status,'answered');
  assert.equal(f.state.events.find(e=>e.type==='textResponseChunk').sources[0].evidenceQuotes.length,2);
  assert.equal(f.state.events.at(-1).type,'finalizeResponseStream');
});
test('직원 답변은 고정문서와 검색 사이 교체를 막고 다른 부서는 계속 처리한다',async t=>{
  const directory=await fs.promises.mkdtemp(path.join(require('node:os').tmpdir(),'schat-stream-snapshot-'));
  t.after(()=>fs.promises.rm(directory,{recursive:true,force:true}));
  const guard=new (require('../../utils/documentUpdates/guard').UpdateGuard)(directory);
  const f=fixture();let pinned=false;
  f.state.withSnapshot=operation=>guard.readWhenAvailable(operation,['search:synthetic']);
  f.state.onPins=async()=>{pinned=true;};
  f.state.onSearch=async()=>{
    assert.equal(pinned,true);
    await assert.rejects(guard.acquire('replace',['search:synthetic']),/DOCUMENT_UPDATE_BUSY/);
    const release=await guard.acquire('other',['search:other']);await release();
  };
  await f.ask();
  assert.equal(f.state.completions,1);
  const release=await guard.acquire('after-retrieval',['search:synthetic']);await release();
});

test('완료한 답변과 캐시 답변은 기록 실패에도 정상 종료되며 저장 실패가 구분됨',async()=>{
  for(const cached of [false,true]) {
    const f=fixture();
    if(cached)await f.ask();
    f.state.events=[];
    f.state.onSave=async()=>{throw new Error('synthetic persistence failure');};
    await f.ask('CT 준비?',{id:2});
    assert.equal(f.state.events.some(event=>event.type==='abort'),false);
    const final=f.state.events.at(-1);
    assert.equal(final.type,'finalizeResponseStream');
    assert.equal(final.chatId,null);
    assert.equal(final.persistenceError,'CHAT_HISTORY_SAVE_FAILED');
  }
});

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

test('normal chat first-question hit skips admission and generation but a follow-up does not',async()=>{
  const f=fixture();f.workspace.chatMode='chat';
  await f.ask('CT 준비?',{id:1},'chat');
  await f.ask('ct준비！',{id:2},'chat');
  assert.equal(f.state.completions,1);
  assert.equal(f.state.admissions,1);
  assert.equal(f.state.records[1].response.metrics.answerCacheHit,true);
  assert.equal(f.state.records[1].response.sources[0].exact_text,'가짜 원문');
  f.state.history=[{id:99}];
  await f.ask('CT 준비?',{id:2},'chat');
  assert.equal(f.state.completions,2);
  assert.equal(f.state.admissions,2);
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
