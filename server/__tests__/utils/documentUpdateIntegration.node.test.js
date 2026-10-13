const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const {executeDocumentUpdate}=require('../../utils/documentUpdates/service');
const {UpdateGuard}=require('../../utils/documentUpdates/guard');
const {createAnswerCache}=require('../../utils/answerCache');
const {documentKey,workspaceKey}=require('../../utils/documentUpdates/scopes');

const {fixture}=require('./documentUpdateFixture');
test('PDF replacement installs all pages, retires old search data and preserves original and related references',async t=>{
  const f=await fixture(t);
  const result=await executeDocumentUpdate(f.request,f.deps);
  assert.equal(result.success,true);
  assert.equal(result.results[0].documents.length,2);
  assert.deepEqual((await f.live.get({include:[]})).ids.sort(),['vector-new-page-1','vector-new-page-2']);
  const rows=await f.prisma.workspace_documents.findMany();
  assert.equal(rows.length,3);
  assert.equal(JSON.parse(rows[0].metadata).schat_document_update_archived,true);
  assert.equal(rows[0].pinned,0);
  assert.equal(await fs.readFile(path.join(f.root,'original-documents','old.pdf'),'utf8'),'%PDF-old');
  assert.equal(result.relatedItems.checklists[0].id,'c1');
  assert.equal(result.relatedItems.quizzes[0].id,7);
  assert.equal(result.relatedItems.pastSources[0].id,8);
  assert.equal(f.deps.cache.stored.ids.includes('old-vector'),false);
  assert.equal(await f.deps.guard.read(async()=>true),true);
});
test('partial retire failure restores original vectors, metadata and file catalog',async t=>{
  const f=await fixture(t,{retireFails:true});
  await assert.rejects(executeDocumentUpdate(f.request,f.deps),/retire transport failed/);
  assert.deepEqual((await f.live.get({include:[]})).ids,['old-vector']);
  const rows=await f.prisma.workspace_documents.findMany();
  assert.equal(rows.length,1);assert.equal(rows[0].pinned,1);assert.equal(rows[0].metadata,'{"document_id":"old-pdf"}');
  assert.deepEqual(await fs.readdir(path.join(f.root,'documents','custom-documents')),['old.json']);
  assert.equal(await f.deps.guard.read(async()=>true),true);
});
test('failed rollback retains durable search lock and complete recovery journal',async t=>{
  const f=await fixture(t,{retireFails:true,restoreFails:true});
  await assert.rejects(executeDocumentUpdate(f.request,f.deps),/DOCUMENT_UPDATE_RECOVERY_REQUIRED/);
  await assert.rejects(new UpdateGuard(path.join(f.root,'guard')).read(async()=>true,[documentKey('규정.pdf')]),/DOCUMENT_UPDATE_LOCKED/);
  const jobs=await fs.readdir(path.join(f.root,'document-updates'));
  const snapshot=JSON.parse(await fs.readFile(path.join(f.root,'document-updates',jobs[0],'rollback.json'),'utf8'));
  assert.equal(snapshot.oldVectors.documents[0],'이전 규정');
  assert.equal(snapshot.newVectors.ids.length,2);
});
test('changed confirmation and cross-workspace sharing never retire old vectors',async t=>{
  const f=await fixture(t);
  f.request.manifest.conflicts=[];
  await assert.rejects(executeDocumentUpdate(f.request,f.deps),/DOCUMENT_PREVIEW_CHANGED/);
  f.request.manifest.conflicts=[{name:'규정.pdf',documents:[{docpath:'custom-documents/old.json',documentId:'old-pdf'}]}];
  await f.prisma.workspace_documents.create({data:{id:2,docId:'shared',filename:'old.json',docpath:'custom-documents/old.json',workspaceId:2,metadata:'{}',pinned:false,watched:false}});
  await assert.rejects(executeDocumentUpdate(f.request,f.deps),/SHARED_DOCUMENT_UPDATE_UNSUPPORTED/);
  assert.deepEqual((await f.live.get({include:[]})).ids,['old-vector']);
});
test('unmapped old vectors prevent replacement rather than leaving old BM25 content searchable',async t=>{
  const f=await fixture(t);
  await f.live.upsert({ids:['orphan'],embeddings:[[1,0]],documents:['이전 규정의 누락된 조각'],metadatas:[{document_id:'old-pdf'}]});
  await assert.rejects(executeDocumentUpdate(f.request,f.deps),/OLD_VECTOR_MAPPING_INCOMPLETE/);
  assert.deepEqual((await f.live.get({include:[]})).ids,['old-vector','orphan']);
  assert.equal((await f.prisma.workspace_documents.findMany()).length,1);
});
test('replacement keeps synthetic documents excluded from employee search',async t=>{
  const f=await fixture(t);
  const filename=path.join(f.root,'documents','custom-documents','old.json');
  const data=JSON.parse(await fs.readFile(filename,'utf8'));data.usage_scope='synthetic';
  await fs.writeFile(filename,JSON.stringify(data));
  await executeDocumentUpdate(f.request,f.deps);
  const rows=await f.prisma.workspace_documents.findMany();
  assert.equal(JSON.parse(rows[1].metadata).usage_scope,'synthetic');
});
test('unlock failure after verified commit preserves new version and recovery journal',async t=>{
  const f=await fixture(t);
  const originalAcquire=f.deps.guard.acquire.bind(f.deps.guard);
  f.deps.guard.acquire=async (job,keys)=>{await originalAcquire(job,keys);return async()=>{throw new Error('unlock storage failure');};};
  await assert.rejects(executeDocumentUpdate(f.request,f.deps),/DOCUMENT_UPDATE_UNLOCK_REQUIRED/);
  assert.equal((await f.live.get({include:[]})).ids.includes('old-vector'),false);
  assert.equal((await f.prisma.workspace_documents.findMany()).length,3);
  await assert.rejects(f.deps.guard.read(async()=>true,[documentKey('규정.pdf')]),/DOCUMENT_UPDATE_LOCKED/);
});
test('unassociated old page cannot remain available for accidental re-embedding',async t=>{
  const f=await fixture(t);
  await f.prisma.workspace_documents.deleteMany({where:{id:1}});
  await f.live.delete({ids:['old-vector']});
  // 연결이 끊긴 남은 쪽은 이제 미리보기에서 빠지므로 '자료 상태 바뀜'으로 먼저 멈출 수 있음. 어느 쪽이든 다시 넣지 않음.
  await assert.rejects(executeDocumentUpdate(f.request,f.deps),/UNASSOCIATED_DOCUMENT_UPDATE_UNSUPPORTED|DOCUMENT_PREVIEW_CHANGED/);
  assert.deepEqual((await f.live.get({include:[]})).ids,[]);
});
test('answer cache stays blocked through cutover and rejects late writes after success or rollback',async t=>{
  for(const retireFails of [false,true]) {
    const f=await fixture(t,{retireFails});
    const before=f.answerCache.generation(1);
    const original=f.live.delete;
    let during;
    f.live.delete=async args=>{
      assert.equal(f.answerCache.get(1,'synthetic'),null);
      during=f.answerCache.generation(1);
      assert.equal(f.answerCache.put({workspaceId:1,question:'during',generation:during,value:{answer:'unsafe'}}),false);
      return original(args);
    };
    if(retireFails)await assert.rejects(executeDocumentUpdate(f.request,f.deps),/retire transport failed/);
    else await executeDocumentUpdate(f.request,f.deps);
    assert.equal(f.answerCache.put({workspaceId:1,question:'old',generation:before,value:{answer:'unsafe'}}),false);
    assert.equal(f.answerCache.put({workspaceId:1,question:'late',generation:during,value:{answer:'unsafe'}}),false);
    assert.equal(f.answerCache.put({workspaceId:1,question:'fresh',generation:f.answerCache.generation(1),value:{answer:'safe'}}),true);
  }
});
test('failed rollback retains both document lock and answer cache gate',async t=>{
  const f=await fixture(t,{retireFails:true,restoreFails:true});
  await assert.rejects(executeDocumentUpdate(f.request,f.deps),/DOCUMENT_UPDATE_RECOVERY_REQUIRED/);
  assert.equal(f.answerCache.get(1,'synthetic'),null);
  assert.equal(f.answerCache.put({workspaceId:1,question:'unsafe',generation:f.answerCache.generation(1),value:{answer:'unsafe'}}),false);
});

test('준비 시작 전에 작업 기록과 문서 잠금을 남기고 다른 작업은 진행된다',async t=>{
  const f=await fixture(t);
  const original=f.deps.collector.processDocument;
  f.deps.collector.processDocument=async (...args)=>{
    const job=args[2];
    const journal=JSON.parse(await fs.readFile(path.join(f.root,'document-updates',job,'job.json'),'utf8'));
    assert.equal(journal.workspace.id,1);
    await assert.rejects(f.deps.guard.read(async()=>true,[documentKey('규정.pdf')]),/DOCUMENT_UPDATE_LOCKED/);
    await assert.rejects(f.deps.guard.acquire('reset',[workspaceKey(1)]),/DOCUMENT_UPDATE_BUSY/);
    assert.equal(await f.deps.guard.read(async()=>7,[workspaceKey(1),documentKey('다른.pdf')]),7);
    assert.equal(await f.deps.guard.read(async()=>8,['search:test']),8);
    return original(...args);
  };
  await executeDocumentUpdate(f.request,f.deps);
});

test('복원 때 벡터 ID가 같아도 내용이 잘못되면 잠금을 유지한다',async t=>{
  const f=await fixture(t,{retireFails:true});
  const original=f.live.upsert;
  f.live.upsert=async data=>original(data.ids.includes('old-vector')?{...data,documents:['corrupted']}:data);
  await assert.rejects(executeDocumentUpdate(f.request,f.deps),/DOCUMENT_UPDATE_RECOVERY_REQUIRED/);
  await assert.rejects(f.deps.guard.read(async()=>true,[documentKey('규정.pdf')]),/DOCUMENT_UPDATE_LOCKED/);
});

test('연속 교체는 보관 구본을 보존하고 현재 검색본만 다시 교체한다',async t=>{
  const f=await fixture(t);
  await executeDocumentUpdate(f.request,f.deps);
  const {previewDocumentUpdates}=require('../../utils/documentUpdates/preview');
  f.request.manifest.conflicts=(await previewDocumentUpdates({root:path.join(f.root,'documents'),names:['규정.pdf']})).conflicts;
  await executeDocumentUpdate(f.request,f.deps);
  assert.deepEqual((await f.live.get()).ids.sort(),['vector-new-page-3','vector-new-page-4']);
  assert.equal((await f.prisma.workspace_documents.findMany()).length,5);
});

test('일시 복원 실패는 같은 서버의 자동 복구로 잠금과 답변 캐시 문을 다시 연다',async t=>{
  const f=await fixture(t,{retireFails:true});
  const original=f.live.upsert;let first=true;
  f.live.upsert=async data=>{if(first&&data.ids.includes('old-vector')){first=false;throw new Error('temporary restore failure');}return original(data);};
  await assert.rejects(executeDocumentUpdate(f.request,f.deps),/DOCUMENT_UPDATE_RECOVERY_REQUIRED/);
  const result=await require('../../utils/documentUpdates/recovery').recoverDocumentUpdates(f.deps);
  assert.equal(result.failed.length,0,JSON.stringify(result));
  assert.deepEqual((await f.live.get()).ids,['old-vector']);
  assert.equal(await f.deps.guard.read(async()=>true,[documentKey('규정.pdf')]),true);
  assert.equal(f.answerCache.put({workspaceId:1,question:'fresh',generation:f.answerCache.generation(1),value:{answer:'safe'}}),true);
});
test('교체가 끝나면 새 버전 쪽 글로 퀴즈 근거를 비교하고 그 결과를 관리자에게 돌려준다',async t=>{
  const f=await fixture(t);
  const calls=[];
  f.deps.quizRelink=async(updates,{db})=>{calls.push({updates,db});return{total:3,kept:2,outdated:1,changed:1,missing:0};};
  const result=await executeDocumentUpdate(f.request,f.deps);
  assert.equal(result.success,true);
  assert.deepEqual(result.quizRelink,{total:3,kept:2,outdated:1,changed:1,missing:0});
  assert.equal(calls.length,1);
  const [update]=calls[0].updates;
  assert.deepEqual(update.oldDocumentIds,['old-pdf']);
  assert.equal(update.documentId,result.results[0].documents[0].documentId);
  assert.deepEqual(update.pages.map(p=>[p.page,p.text]).sort(),[[1,'새 규정 1'],[2,'새 규정 2']]);
  assert.equal(calls[0].db,f.prisma);
});
test('퀴즈 근거 비교가 실패해도 끝난 문서 교체는 되돌리지 않고 확인 안내만 남긴다',async t=>{
  const f=await fixture(t);
  f.deps.quizRelink=async()=>{throw new Error('synthetic relink failure');};
  const result=await executeDocumentUpdate(f.request,f.deps);
  assert.equal(result.success,true);
  assert.equal(result.quizRelink,null);
  assert.match(result.warnings[0],/퀴즈 근거 비교/);
  assert.deepEqual((await f.live.get({include:[]})).ids.sort(),['vector-new-page-1','vector-new-page-2']);
});
