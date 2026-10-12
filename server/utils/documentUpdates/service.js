const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { previewDocumentUpdates } = require('./preview');
const { guard: defaultGuard, processOwner } = require('./guard');
const { documentKey, workspaceKey, searchKey } = require('./scopes');
const { isDeepStrictEqual } = require('node:util');

function fail(code) { throw new Error(code); }
function isMissingCollection(error) {
  return error?.name==='ChromaNotFoundError' || /not.?found|does not exist|missing collection/i.test(error?.message||'');
}
function validateBatch(files, manifest) {
  if (!Array.isArray(files) || !files.length || files.length > 50 || !manifest ||
      !Array.isArray(manifest.names) || !Array.isArray(manifest.conflicts) ||
      JSON.stringify(files.map(f => f.originalname)) !== JSON.stringify(manifest.names)) fail('BATCH_CHANGED');
  if (files.some(f => !/\.pdf$/i.test(f.originalname))) fail('PDF_ONLY');
  const folderName = manifest.folderName || 'custom-documents';
  if (typeof folderName !== 'string' || !folderName.trim() || folderName.startsWith('.') || /[\\/:\u0000-\u001f]/.test(folderName)) fail('INVALID_FOLDER');
  return { ...manifest, folderName };
}
function verifyVectors(data, expected) {
  if (!data || !Array.isArray(data.ids) || data.ids.length !== expected.length ||
      new Set(data.ids).size !== expected.length || expected.some(id => !data.ids.includes(id)) ||
      ['embeddings','documents','metadatas'].some(key => !Array.isArray(data[key]) || data[key].length !== expected.length) ||
      data.embeddings.some(v => !Array.isArray(v) || !v.length || v.some(x => !Number.isFinite(x))) ||
      data.documents.some(x => typeof x !== 'string') || data.metadatas.some(x => !x || typeof x !== 'object')) fail('VECTOR_VERIFICATION_FAILED');
}
function verifyVectorContents(actual, expected) {
  verifyVectors(actual, expected.ids);
  for (let i=0;i<expected.ids.length;i++) {
    const at=actual.ids.indexOf(expected.ids[i]);
    if (actual.documents[at]!==expected.documents[i] || !isDeepStrictEqual(actual.metadatas[at],expected.metadatas[i]) ||
        actual.embeddings[at].length!==expected.embeddings[i].length ||
        actual.embeddings[at].some((value,j)=>Math.abs(value-expected.embeddings[i][j])>1e-6*Math.max(1,Math.abs(expected.embeddings[i][j])))) fail('VECTOR_CONTENT_VERIFICATION_FAILED');
  }
}
function defaults() {
  return {
    root: process.env.STORAGE_DIR || path.resolve(__dirname, '../../storage'),
    provider: process.env.VECTOR_DB,
    prisma: require('../prisma'),
    vector: require('../helpers').getVectorDbClass(),
    collector: new (require('../collectorApi').CollectorApi)(),
    preserve: require('../originalDocuments').persistOriginalPdf,
    cache: require('../vectorDbProviders/chroma/searchCache'),
    purgeCache: require('../files').purgeVectorCache,
    policy: require('../vectorDbProviders/chroma/schatPolicy').SCHAT_CHUNK_POLICY_VERSION,
    checklists: require('../documentChecklists/repository').ChecklistRepository,
  };
}
async function durableJson(filename, value) {
  const temporary=path.join(path.dirname(filename),`.${path.basename(filename)}.${randomUUID()}.tmp`);
  const handle = await fs.open(temporary, 'wx', 0o600);
  try { await handle.writeFile(JSON.stringify(value)); await handle.sync(); }
  finally { await handle.close(); }
  // Hard-link publication is atomic and refuses an existing destination on
  // both supported filesystems. Recovery never reads the private temp name.
  try {await fs.link(temporary,filename);}
  finally {await fs.unlink(temporary).catch(()=>{});}
}
async function marker(jobRoot, name, job) {
  try { await durableJson(path.join(jobRoot,name),{job,at:new Date().toISOString()}); }
  catch(error) {
    if(error.code!=='EEXIST' || JSON.parse(await fs.readFile(path.join(jobRoot,name),'utf8')).job!==job) throw error;
  }
}
async function verifyDatabase(deps,snapshot,committed) {
  const oldIds=snapshot.oldRows.map(row=>row.docId), newIds=snapshot.newDocuments.map(row=>row.docId);
  const rows=await deps.prisma.workspace_documents.findMany({where:{docId:{in:[...oldIds,...newIds]}}});
  if(rows.length!==snapshot.oldRows.length+(committed?snapshot.newDocuments.length:0)) fail('DATABASE_VERIFICATION_FAILED');
  for(const old of snapshot.oldRows) {
    const row=rows.find(row=>row.id===old.id);
    const metadata=committed?JSON.stringify({...JSON.parse(old.metadata||'{}'),schat_document_update_archived:true,schat_document_update_job:snapshot.job}):old.metadata;
    if(!row || row.docId!==old.docId || row.docpath!==old.docpath || row.workspaceId!==old.workspaceId || row.metadata!==metadata ||
       Boolean(row.pinned)!==(committed?false:Boolean(old.pinned)) || Boolean(row.watched)!==(committed?false:Boolean(old.watched))) fail('DATABASE_VERIFICATION_FAILED');
  }
  for(const doc of committed?snapshot.newDocuments:[]) {
    const row=rows.find(row=>row.docId===doc.docId);
    if(!row || row.docpath!==doc.docpath || row.workspaceId!==snapshot.workspace.id || JSON.parse(row.metadata||'{}').document_id!==doc.documentId) fail('DATABASE_VERIFICATION_FAILED');
  }
  const mappings=await deps.prisma.document_vectors.findMany({where:{docId:{in:[...oldIds,...newIds]}}});
  const expected=committed?snapshot.newMappings:snapshot.oldMappings;
  if(mappings.length!==expected.length || expected.some(value=>!mappings.some(row=>row.id===value.id && row.docId===value.docId && row.vectorId===value.vectorId))) fail('MAPPING_VERIFICATION_FAILED');
}
async function verifySearch(deps,live,snapshot,committed) {
  const present=committed?snapshot.newVectors:snapshot.oldVectors;
  const absent=committed?snapshot.oldVectors:snapshot.newVectors;
  verifyVectorContents(await vectorData(live,present.ids),present);
  if((await vectorData(live,absent.ids)).ids.length) fail('SEARCH_VERIFICATION_FAILED');
  deps.cache.invalidate();
  const corpus=await deps.cache.loadCorpus(live,snapshot.workspace.slug);
  const stored=corpus.stored;
  const expectedIds=committed?[...snapshot.liveBeforeIds.filter(id=>!snapshot.oldVectors.ids.includes(id)),...snapshot.newVectors.ids]:snapshot.liveBeforeIds;
  if(stored.ids.length!==expectedIds.length || expectedIds.some(id=>!stored.ids.includes(id)) || absent.ids.some(id=>stored.ids.includes(id))) fail('SEARCH_CACHE_VERIFICATION_FAILED');
  for(let i=0;i<present.ids.length;i++) {
    const at=stored.ids.indexOf(present.ids[i]);
    if(stored.documents[at]!==present.documents[i] || !isDeepStrictEqual(stored.metadatas[at],present.metadatas[i])) fail('SEARCH_CACHE_VERIFICATION_FAILED');
  }
}
async function restoreSnapshot(deps,live,snapshot,jobRoot) {
  await removeVectors(live,snapshot.newVectors.ids);
  await addVectors(live,snapshot.oldVectors);
  await deps.prisma.$transaction(async tx=>{
    await tx.workspace_documents.deleteMany({where:{docId:{in:snapshot.newDocuments.map(d=>d.docId)}}});
    for(const row of snapshot.oldRows) await tx.workspace_documents.update({where:{id:row.id},data:{metadata:row.metadata,pinned:Boolean(row.pinned),watched:Boolean(row.watched)}});
    await tx.document_vectors.deleteMany({where:{docId:{in:[...snapshot.oldRows.map(d=>d.docId),...snapshot.newDocuments.map(d=>d.docId)]}}});
    for(const row of snapshot.oldMappings) await tx.document_vectors.upsert({where:{id:row.id},create:row,update:row});
  });
  for(const doc of snapshot.newDocuments) {
    const target=path.resolve(deps.root,'documents',doc.docpath);
    const catalog=path.resolve(deps.root,'documents')+path.sep;
    if(!target.startsWith(catalog)) fail('DOCUMENT_UPDATE_RECOVERY_UNVERIFIED');
    try {
      const data=JSON.parse(await fs.readFile(target,'utf8'));
      if(data.document_id!==doc.documentId) fail('DOCUMENT_UPDATE_RECOVERY_UNVERIFIED');
      await fs.unlink(target);
    } catch(error) { if(error.code!=='ENOENT') throw error; }
  }
  await verifyDatabase(deps,snapshot,false);
  await verifySearch(deps,live,snapshot,false);
  await marker(jobRoot,'rolled-back.json',snapshot.job);
}
async function vectorData(collection, ids) {
  if (!ids.length) return {ids:[],embeddings:[],documents:[],metadatas:[]};
  return collection.get({ids, include:['embeddings','documents','metadatas']});
}
async function addVectors(collection, data) {
  for (let i=0;i<data.ids.length;i+=200) {
    const batch = Object.fromEntries(['ids','embeddings','documents','metadatas'].map(key=>[key,data[key].slice(i,i+200)]));
    await collection.upsert(batch);
  }
}
async function removeVectors(collection, ids) {
  for (let i=0;i<ids.length;i+=200) await collection.delete({ids:ids.slice(i,i+200)});
}
function canonical(preview) {
  return JSON.stringify(preview.map(x => ({name:x.name,documents:x.documents.map(d=>({docpath:d.docpath,documentId:d.documentId})).sort((a,b)=>a.docpath.localeCompare(b.docpath))})).sort((a,b)=>a.name.localeCompare(b.name)));
}
async function relatedItems(deps, workspace, oldRows) {
  const ids = [...new Set(oldRows.map(row=>JSON.parse(row.metadata || '{}').document_id).filter(Boolean))];
  const selected = new Set(ids);
  const checklists = deps.checklists.listAll().filter(item=>selected.has(item.documentId)).map(item=>({id:item.id,title:item.title || item.name || '체크리스트',documentId:item.documentId}));
  const quizzes = await deps.prisma.schat_quiz_sets.findMany({where:{document_id:{in:ids}},select:{id:true,title:true,document_id:true}});
  const chats = await deps.prisma.workspace_chats.findMany({where:{workspaceId:workspace.id},select:{id:true,response:true}});
  const pastSources = [];
  for (const chat of chats) {
    let response;
    try { response=JSON.parse(chat.response); } catch { fail('PAST_SOURCE_INDEX_UNAVAILABLE'); }
    if ((response.sources || []).some(source=>selected.has(source.document_id) || oldRows.some(row=>source.docId===row.docId || source.docpath===row.docpath))) pastSources.push({id:chat.id,title:'과거 답변 출처'});
  }
  return {checklists,quizzes,pastSources};
}

async function executeDocumentUpdate({workspace, files, manifest:input}, injected) {
  const manifest = validateBatch(files,input);
  const deps = injected || defaults();
  if (deps.provider !== 'chroma') fail('CHROMA_REQUIRED');
  const guard = deps.guard || defaultGuard;
  const job = randomUUID();
  const stageName = `update-${job}`;
  const jobRoot = path.join(deps.root,'document-updates',job);
  const catalog = path.join(deps.root,'documents');
  const prepared = [];
  const keys = [...new Set(manifest.names.map(documentKey))];
  const workspaceKeys = [workspaceKey(workspace.id)];
  const searchKeys = [searchKey(deps.vector.normalize(workspace.slug))];
  let client, stage, live, release, releaseWorkspace, releaseSearch, snapshot, changed=false, recovery=false;
  const installed = [];
  await fs.mkdir(jobRoot,{recursive:true});
  const ownerLease=await require('./ownerLease').acquireOwnerLease(jobRoot);
  try {await durableJson(path.join(jobRoot,'job.json'),{version:1,job,owner:processOwner,ownerEvidence:ownerLease.kind,workspace:{id:workspace.id,slug:workspace.slug},keys,workspaceKeys,searchKeys,stageName});}
  catch(error){await ownerLease.release();throw error;}
  const finishAnswerCache = (deps.answerCacheRuntime || require('../answerCacheRuntime')).beginMutation([workspace.id]);
  try {
    releaseWorkspace=await guard.acquireRead(job,workspaceKeys);
    release=await guard.acquire(job,keys);
    const preview = await previewDocumentUpdates({root:catalog,names:manifest.names});
    if (canonical(preview.conflicts)!==canonical(manifest.conflicts)) fail('DOCUMENT_PREVIEW_CHANGED');
    // New IDs keep originals, images and provisional vector mappings separate.
    for (const file of files) {
      const documentId=randomUUID();
      await durableJson(path.join(jobRoot,`original-${documentId}.json`),{documentId,name:file.originalname});
      const prior=preview.conflicts.find(item=>item.name===file.originalname);
      const scopes=new Set();
      for (const reference of prior?.documents || []) {
        const source=JSON.parse(await fs.readFile(path.join(catalog,reference.docpath),'utf8'));
        scopes.add(String(source.usage_scope || source.document_class || 'employee'));
      }
      if (scopes.size>1) fail('MIXED_DOCUMENT_SCOPE_UNSUPPORTED');
      const usage_scope=[...scopes][0] || 'employee';
      await deps.preserve({sourcePath:file.path,documentId,originalName:file.originalname});
      const result=await deps.collector.processDocument(file.filename,{document_id:documentId,title:file.originalname,usage_scope},job);
      if (!result?.success || !Array.isArray(result.documents) || !result.documents.length) fail('PDF_PREPARATION_FAILED');
      for (const data of result.documents) {
        const filename=String(data.location || '').replace(/\\/g,'/').split('/').pop();
        if (!filename?.endsWith('.json') || filename==='..' || data.document_id!==documentId) fail('ISOLATED_COLLECTOR_REQUIRED');
        const stagedPath=path.join(jobRoot,'documents',filename);
        const stored=JSON.parse(await fs.readFile(stagedPath,'utf8'));
        if (stored.document_id!==documentId || stored.id!==data.id || typeof stored.pageContent!=='string') fail('ISOLATED_COLLECTOR_REQUIRED');
        const docId=randomUUID();
        const docpath=`${manifest.folderName}/${filename}`;
        prepared.push({name:file.originalname,docId,docpath,filename,documentId,stagedPath,data:stored});
        await durableJson(path.join(jobRoot,`prepared-${docId}.json`),{docId,docpath,documentId});
        const embedded=await deps.vector.addDocumentToNamespace(stageName,{...stored,docId},null,true);
        if (!embedded?.vectorized) fail('VECTOR_PREPARATION_FAILED');
      }
    }
    ({client}=await deps.vector.connect());
    stage=await client.getCollection({name:stageName});
    const newMappings=await deps.prisma.document_vectors.findMany({where:{docId:{in:prepared.map(d=>d.docId)}}});
    const newIds=newMappings.map(row=>row.vectorId);
    if (!newIds.length || prepared.some(doc=>!newMappings.some(row=>row.docId===doc.docId))) fail('VECTOR_VERIFICATION_FAILED');
    const newVectors=await vectorData(stage,newIds);
    verifyVectors(newVectors,newIds);
    if ((await stage.count())!==newIds.length || newVectors.metadatas.some(m=>!prepared.some(p=>p.documentId===m.document_id))) fail('VECTOR_VERIFICATION_FAILED');
    releaseSearch=await guard.acquireWhenAvailable(job,searchKeys);
    return await guard.owned(async()=>{
      const fresh=await previewDocumentUpdates({root:catalog,names:manifest.names});
      if (canonical(fresh.conflicts)!==canonical(manifest.conflicts)) fail('DOCUMENT_PREVIEW_CHANGED');
      const paths=fresh.conflicts.flatMap(item=>item.documents.map(d=>d.docpath));
      const rows=await deps.prisma.workspace_documents.findMany({where:{docpath:{in:paths}}});
      if (paths.some(docpath=>!rows.some(row=>row.docpath===docpath))) fail('UNASSOCIATED_DOCUMENT_UPDATE_UNSUPPORTED');
      const oldRows=rows.filter(row=>JSON.parse(row.metadata || '{}').schat_document_update_archived!==true);
      if (oldRows.some(row=>row.workspaceId!==workspace.id)) fail('SHARED_DOCUMENT_UPDATE_UNSUPPORTED');
      if (oldRows.some(row=>row.watched)) fail('WATCHED_DOCUMENT_UPDATE_UNSUPPORTED');
      const oldMappings=await deps.prisma.document_vectors.findMany({where:{docId:{in:oldRows.map(row=>row.docId)}}});
      const oldIds=oldMappings.map(row=>row.vectorId);
      live=await client.getOrCreateCollection({name:deps.vector.normalize(workspace.slug),metadata:{'hnsw:space':'cosine'}});
      const liveBefore=await live.get({include:['metadatas']});
      const oldDocumentIds=new Set(fresh.conflicts.flatMap(item=>item.documents.map(d=>d.documentId)).filter(Boolean));
      if (liveBefore.ids.some((id,index)=>oldDocumentIds.has(liveBefore.metadatas[index]?.document_id) && !oldIds.includes(id))) fail('OLD_VECTOR_MAPPING_INCOMPLETE');
      const oldVectors=await vectorData(live,oldIds);
      verifyVectors(oldVectors,oldIds);
      const related=await relatedItems(deps,workspace,oldRows);
      snapshot={job,workspace:{id:workspace.id,slug:workspace.slug},oldRows,oldMappings,oldVectors,newMappings,newVectors,liveBeforeIds:liveBefore.ids,newDocuments:prepared.map(({data,stagedPath,...rest})=>rest)};
      await durableJson(path.join(jobRoot,'rollback.json'),snapshot);
      ownerLease.assertActive();
      changed=true;
      const targetFolder=path.join(catalog,manifest.folderName);
      await fs.mkdir(targetFolder,{recursive:true});
      if ((await fs.lstat(targetFolder)).isSymbolicLink()) fail('DOCUMENT_CATALOG_LINK_UNSUPPORTED');
      for (const doc of prepared) {
        const target=path.join(catalog,doc.docpath);
        // Stage JSON is complete and immutable. Publish one complete inode;
        // an interrupted copy must never expose a partial catalog document.
        await fs.link(doc.stagedPath,target);
        installed.push(target);
      }
      await addVectors(live,newVectors);
      ownerLease.assertActive();
      verifyVectorContents(await vectorData(live,newIds),newVectors);
      await removeVectors(live,oldIds);
      ownerLease.assertActive();
      if ((await vectorData(live,oldIds)).ids.length) fail('OLD_VECTORS_REMAIN');
      await deps.prisma.$transaction(async tx=>{
        for (const old of oldRows) await tx.workspace_documents.update({where:{id:old.id},data:{metadata:JSON.stringify({...JSON.parse(old.metadata || '{}'),schat_document_update_archived:true,schat_document_update_job:job}),pinned:false,watched:false}});
        for (const doc of prepared) {
          const {pageContent,...metadata}=doc.data;
          await tx.workspace_documents.create({data:{docId:doc.docId,filename:doc.filename,docpath:doc.docpath,workspaceId:workspace.id,metadata:JSON.stringify(metadata)}});
        }
        await tx.document_vectors.deleteMany({where:{docId:{in:oldRows.map(row=>row.docId)}}});
      });
      for (const old of oldRows) {
        await deps.purgeCache(old.docpath);
        await deps.purgeCache(`${old.docpath}::${deps.policy}`);
      }
      deps.cache.invalidate();
      await verifyDatabase(deps,snapshot,true);
      await verifySearch(deps,live,snapshot,true);
      ownerLease.assertActive();
      await durableJson(path.join(jobRoot,'committed.json'),{job,at:new Date().toISOString()});
      // 퀴즈 근거 문장이 새 버전에 그대로 있으면 새 문서에 이어 붙인다(AI 없음).
      // 문서 교체는 이미 끝났으므로 이 단계가 실패해도 교체를 되돌리지 않는다.
      const warnings=[];
      let quizRelink=null;
      const relink=deps.quizRelink ?? (injected ? null : require('../schatQuiz/bank').relinkAfterDocumentUpdate);
      if (relink) {
        try {
          quizRelink=await relink(fresh.conflicts.map(item=>{
            const docs=prepared.filter(d=>d.name===item.name);
            return {oldDocumentIds:item.documents.map(d=>d.documentId).filter(Boolean),documentId:docs[0]?.documentId,
              title:item.name,version:docs[0]?.data?.document_version ?? null,workspaceSlug:workspace.slug,
              pages:docs.map(d=>({page:d.data.page,text:d.data.pageContent}))};
          }).filter(update=>update.documentId),{db:deps.prisma});
        } catch {
          warnings.push('퀴즈 근거 비교를 끝내지 못했습니다. 관리자 퀴즈 화면의 이전 문서 목록을 확인해 주세요.');
        }
      }
      return {success:true,results:files.map(file=>({name:file.originalname,documents:prepared.filter(d=>d.name===file.originalname).map(d=>({docpath:d.docpath,documentId:d.documentId}))})),relatedItems:related,quizRelink,warnings};
    }, [...keys,...workspaceKeys,...searchKeys]);
  } catch (error) {
    if (changed && snapshot && !recovery) {
      try {
        await guard.owned(async()=>{
          await restoreSnapshot(deps,live,snapshot,jobRoot);
        }, [...keys,...workspaceKeys,...searchKeys]);
      } catch (restoreError) {
        recovery=true;
        throw new AggregateError([error,restoreError],'DOCUMENT_UPDATE_RECOVERY_REQUIRED');
      }
    }
    throw error;
  } finally {
    try {
      if (!recovery) {
        // Keep originals and journals permanently; only isolated provisional
        // vectors/mappings are eligible for cleanup after a safe rollback.
        if (client || prepared.length) {
          client ||= (await deps.vector.connect()).client;
          try {await client.deleteCollection({name:stageName});}
          catch(error){if(!isMissingCollection(error))throw error;}
        }
        if (!changed || snapshot && await fs.stat(path.join(jobRoot,'rolled-back.json')).then(()=>true,()=>false))
          await deps.prisma.document_vectors.deleteMany({where:{docId:{in:prepared.map(d=>d.docId)}}});
        await marker(jobRoot,'finished.json',job);
        if (releaseSearch) { await releaseSearch(); releaseSearch=null; }
        if (release) { await release(); release=null; }
        if (releaseWorkspace) { await releaseWorkspace(); releaseWorkspace=null; }
        await marker(jobRoot,'released.json',job);
      }
    } catch(error) {
      recovery=true;
      throw new Error('DOCUMENT_UPDATE_UNLOCK_REQUIRED',{cause:error});
    } finally {
      if(recovery)require('./recovery').retainRecovery(job,finishAnswerCache);
      else finishAnswerCache();
      await ownerLease.release();
    }
    // Recovery keeps the existing durable document lock AND this process's
    // answer gate closed. A verified success/rollback starts a fresh generation.
  }
}
module.exports={validateBatch,verifyVectors,verifyVectorContents,executeDocumentUpdate,defaults,durableJson,marker,verifyDatabase,verifySearch,restoreSnapshot,isMissingCollection};
