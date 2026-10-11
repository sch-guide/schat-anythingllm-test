const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const {fork}=require('node:child_process');
const {fixture}=require('./documentUpdateFixture');
const {documentKey,workspaceKey}=require('../../utils/documentUpdates/scopes');
async function crash(f,phase) {
  const child=fork(path.join(__dirname,'documentUpdateCrashWorker.js'),[f.root,phase],{stdio:['ignore','ignore','pipe','ipc']});
  let stderr='';child.stderr.on('data',part=>stderr+=part);
  await new Promise((resolve,reject)=>{
    const timeout=setTimeout(()=>{child.kill();reject(new Error(`worker timeout: ${stderr}`));},10000);
    child.once('message',()=>{clearTimeout(timeout);resolve();});
    child.once('exit',code=>{clearTimeout(timeout);reject(new Error(`worker exited ${code}: ${stderr}`));});
  });
  await new Promise(resolve=>{child.once('exit',resolve);child.kill('SIGKILL');});
}
for(const phase of ['preparation','retire','committed'])test(`강제 종료 후 ${phase} 단계 자동 복구를 반복해도 자료가 유지된다`,async t=>{
  const f=await fixture(t,{persistent:true});
  await crash(f,phase);
  const {recoverDocumentUpdates}=require('../../utils/documentUpdates/recovery');
  const result=await recoverDocumentUpdates(f.deps);
  assert.equal(result.failed.length,0,JSON.stringify(result));
  assert.equal(result.recovered.length,1);
  assert.deepEqual((await recoverDocumentUpdates(f.deps)).failed,[]);
  const ids=(await f.live.get()).ids.sort();
  assert.deepEqual(ids,phase==='committed'?['vector-new-page-1','vector-new-page-2']:['old-vector']);
  const release=await f.deps.guard.acquire('reset',[workspaceKey(1),documentKey('규정.pdf'),'search:test']);
  await release();
  assert.equal(await fs.readFile(path.join(f.root,'original-documents','old.pdf'),'utf8'),'%PDF-old');
});
test('복구 중 강제 종료해도 다음 복구가 원래 내용과 연결을 검증한다',async t=>{
  const f=await fixture(t,{persistent:true});
  await crash(f,'retire');
  await crash(f,'recovery');
  const {recoverDocumentUpdates}=require('../../utils/documentUpdates/recovery');
  const result=await recoverDocumentUpdates(f.deps);
  assert.equal(result.failed.length,0,JSON.stringify(result));
  assert.deepEqual((await f.live.get({include:['documents','embeddings']})),{ids:['old-vector'],documents:['이전 규정'],embeddings:[[1,0]]});
  assert.equal((await f.prisma.workspace_documents.findMany()).length,1);
  assert.equal((await f.prisma.document_vectors.findMany()).length,1);
});

for(const phase of ['journal-write:rollback.json','journal-partial:rollback.json','journal-published:rollback.json',
  'journal-partial:committed.json','journal-published:committed.json','journal-partial:finished.json','journal-published:finished.json',
  'catalog-publication','catalog-published'])test(`기록 또는 문서 작성 중 ${phase} 강제 종료도 자동 복구된다`,async t=>{
  const f=await fixture(t,{persistent:true});
  await crash(f,phase);
  const result=await require('../../utils/documentUpdates/recovery').recoverDocumentUpdates(f.deps);
  assert.equal(result.failed.length,0,JSON.stringify(result));
  assert.equal(result.recovered.length,1);
  const committed=['journal-published:committed.json','journal-partial:finished.json','journal-published:finished.json'].includes(phase);
  assert.deepEqual((await f.live.get()).ids.sort(),committed?['vector-new-page-1','vector-new-page-2']:['old-vector']);
  if(!committed)assert.deepEqual(await fs.readdir(path.join(f.root,'documents','custom-documents')),['old.json']);
  if(phase.startsWith('catalog-')) {
    const jobs=(await fs.readdir(path.join(f.root,'document-updates'))).filter(name=>/^[a-f0-9-]{36}$/.test(name));
    const stage=path.join(f.root,'document-updates',jobs[0],'documents');
    const names=await fs.readdir(stage);
    assert.ok(names.length>0);
    for(const name of names)assert.ok(JSON.parse(await fs.readFile(path.join(stage,name),'utf8')).title);
  }
  const release=await f.deps.guard.acquire('next',['search:test',documentKey('규정.pdf'),workspaceKey(1)]);await release();
});

test('원자 기록 게시가 이미 있는 최종 파일을 덮어쓰지 않는다',async t=>{
  const root=await fs.mkdtemp(path.join(require('node:os').tmpdir(),'schat-journal-no-clobber-'));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const filename=path.join(root,'job.json'),{durableJson}=require('../../utils/documentUpdates/service');
  await durableJson(filename,{job:'first'});
  await assert.rejects(durableJson(filename,{job:'second'}),error=>error.code==='EEXIST');
  assert.deepEqual(JSON.parse(await fs.readFile(filename,'utf8')),{job:'first'});
  assert.deepEqual(await fs.readdir(root),['job.json']);
});
