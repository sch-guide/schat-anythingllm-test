const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const vm=require('node:vm');
const {EventEmitter}=require('node:events');
const shared=require('../../utils/documentUpdates/guard');
function routesFor(filename,collect) {
  const module={exports:{}},routes=new Map();
  const http={reqBody:r=>r.body||{},safeJsonParse:(s,f)=>{try{return JSON.parse(s);}catch{return f;}},multiUserMode:()=>false,userFromSession:async()=>({id:1})};
  vm.runInNewContext(fs.readFileSync(filename,'utf8'),{
    module,exports:module.exports,console,__dirname:path.dirname(filename),process:{env:{NODE_ENV:'development'}},
    require(name) {
      if(name==='fs'||name==='path')return require(name);
      if(name.endsWith('/documentUpdates/guard'))return shared;
      if(name.endsWith('/http'))return http;
      if(name.endsWith('/collectorApi'))return {CollectorApi:class {online=async()=>true;processDocument=collect;log(){} }};
      if(name.endsWith('/multiUserProtected'))return {ROLES:{},flexUserRoleValid:()=>()=>{}};
      if(name.endsWith('/workspacesParsedFiles'))return {workspaceParsedFilesEndpoints(){}};
      if(name==='./originalSpreadsheets')return ()=>{};
      if(name.endsWith('/answerFeedback'))return {feedbackSaveHandler:()=>()=>{}};
      if(name.endsWith('/workspace'))return {Workspace:{get:async()=>({id:1,slug:'test'})}};
      if(name.endsWith('/originalPdfUpload'))return {prepareOriginalPdfUpload:async()=>({metadata:{}})};
      if(name.endsWith('/telemetry'))return {Telemetry:{sendTelemetry:async()=>{}}};
      if(name.endsWith('/eventLogs'))return {EventLogs:{logEvent:async()=>{}}};
      if(name.endsWith('/files'))return {moveProcessedDocsToFolder:()=> 'custom-documents'};
      return {};
    }
  },{filename});
  Object.values(module.exports)[0](new Proxy({}, {get:(_,verb)=>(route,...handlers)=>routes.set(`${verb} ${route}`,handlers.flat())}));
  return routes;
}
for(const route of ['/v1/document/upload','/v1/document/upload/:folderName','/workspace/:slug/upload-and-embed'])test(`${route} 연결 종료 후에도 Collector 종료까지 교체 잠금을 유지한다`,async t=>{
  const root=await fs.promises.mkdtemp(path.join(os.tmpdir(),'schat-api-upload-'));
  t.after(()=>fs.promises.rm(root,{recursive:true,force:true}));
  const guard=new shared.UpdateGuard(root),original=shared.guard.read;
  shared.guard.read=guard.read.bind(guard);
  let start,finish;
  const started=new Promise(r=>start=r),gate=new Promise(r=>finish=r);
  const filename=path.resolve(__dirname,'../../endpoints',route.startsWith('/v1')?'api/document/index.js':'workspaces.js');
  const routes=routesFor(filename,async()=>{start();await gate;return {success:false,reason:'synthetic-stop',documents:[]};});
  const response=Object.assign(new EventEmitter(),{locals:{},status(){return this;},json(){return this;},end(){return this;},sendStatus(){return this;}});
  const active=routes.get(`post ${route}`).at(-1)({file:{originalname:'guide.pdf'},params:{slug:'test'},body:{}},response);
  try {
    await Promise.race([started,active.then(()=>{throw Error('Collector not entered');})]);
    response.emit('close');
    let escaped;
    try {await assert.rejects(async()=>{escaped=await guard.acquire('replace',['document:guide.pdf']);},/DOCUMENT_UPDATE_BUSY/);}
    finally {if(escaped)await escaped();}
  } finally {finish();await active;shared.guard.read=original;}
  const release=await guard.acquire('after',['document:guide.pdf']);await release();
});

function responseForTest() {
  return {headersSent:false,statusCode:null,body:null,locals:{},status(code){this.statusCode=code;return this;},
    sendStatus(code){this.statusCode=code;return this;},json(body){this.body=body;this.headersSent=true;return this;},end(){return this;}};
}
for(const route of ['/v1/document/upload','/v1/document/upload/:folderName'])test(`${route} 잘못된 제목은 400, 정상 요청은 200, 잠금 충돌은 423으로 끝난다`,async t=>{
  const root=await fs.promises.mkdtemp(path.join(os.tmpdir(),'schat-upload-response-'));
  t.after(()=>fs.promises.rm(root,{recursive:true,force:true}));
  const guard=new shared.UpdateGuard(root),original=shared.guard.read;
  shared.guard.read=guard.read.bind(guard);
  let collected=0;
  const handler=routesFor(path.resolve(__dirname,'../../endpoints/api/document/index.js'),async()=>{
    collected++;return {success:true,documents:[{location:'custom-documents/synthetic.json'}]};
  }).get(`post ${route}`).at(-1);
  const request=title=>({file:{originalname:'guide.pdf'},params:{},body:{metadata:JSON.stringify({title})}});
  try {
    for(const title of ['.','..','bad\ntitle']) {
      const response=responseForTest();
      await assert.doesNotReject(handler(request(title),response));
      assert.equal(response.statusCode,400);
      assert.equal(response.body.code,'DOCUMENT_UPDATE_INVALID_SCOPE');
    }
    assert.equal(collected,0);
    const normal=responseForTest();await handler(request('guide.pdf'),normal);
    assert.equal(normal.statusCode,200);assert.equal(normal.body.success,true);assert.equal(collected,1);
    const release=await guard.acquire('replace',['document:guide.pdf']);
    try {
      const busy=responseForTest();await handler(request('guide.pdf'),busy);
      assert.equal(busy.statusCode,423);assert.equal(busy.body.code,'DOCUMENT_UPDATE_LOCKED');assert.equal(collected,1);
    } finally {await release();}
    shared.guard.read=async()=>{throw Object.assign(new Error('synthetic-filesystem-denied'),{code:'EACCES'});};
    const denied=responseForTest();
    await assert.doesNotReject(handler(request('guide.pdf'),denied));
    assert.equal(denied.statusCode,500);assert.equal(denied.body.code,'DOCUMENT_UPLOAD_FAILED');
    assert.equal(denied.body.error.includes('synthetic-filesystem-denied'),false);assert.equal(collected,1);
  } finally {shared.guard.read=original;}
});

test('처리 중 일반 오류도 응답으로 끝내고 잠금을 풀며 응답 종료 뒤 오류를 다시 던지지 않는다',async t=>{
  const root=await fs.promises.mkdtemp(path.join(os.tmpdir(),'schat-upload-error-'));
  t.after(()=>fs.promises.rm(root,{recursive:true,force:true}));
  const guard=new shared.UpdateGuard(root),original=shared.guard.read;
  shared.guard.read=guard.read.bind(guard);
  try {
    for(const file of [undefined,{originalname:'guide.pdf'}])for(const headersSent of [false,true]) {
      const response=responseForTest();response.headersSent=headersSent;
      await assert.doesNotReject(async()=>shared.catalogWriteLease({file},response,async()=>{throw Error('synthetic-internal-error');}));
      assert.equal(response.statusCode,headersSent?null:500);
      if(!headersSent)assert.equal(response.body.error.includes('synthetic-internal-error'),false);
    }
    const release=await guard.acquire('after-error',['document:guide.pdf']);await release();
  } finally {shared.guard.read=original;}
});
