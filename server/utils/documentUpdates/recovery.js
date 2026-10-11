const fs=require('node:fs/promises');
const path=require('node:path');
const {guard:defaultGuard,ownerHasExited,processOwner,retainedJobs}=require('./guard');
const {defaults,marker,verifyDatabase,verifySearch,restoreSnapshot,isMissingCollection}=require('./service');
const pending=new Map();
function retainRecovery(job,finish) {retainedJobs.add(job);pending.set(job,finish);}
async function optionalJson(filename) {
  try{return JSON.parse(await fs.readFile(filename,'utf8'));}
  catch(error){if(error.code==='ENOENT')return null;throw error;}
}
async function recoverDocumentUpdates(injected) {
  const root=injected?.root || process.env.STORAGE_DIR || path.resolve(__dirname,'../../storage');
  const directory=path.join(root,'document-updates');
  const names=await fs.readdir(directory).catch(error=>{if(error.code==='ENOENT')return[];throw error;});
  const result={recovered:[],failed:[]};
  let deps=injected;
  for(const job of names.filter(name=>/^[a-f0-9-]{36}$/.test(name))) {
    let ownerLease=null;
    try {
      const jobRoot=path.join(directory,job);
      if(await optionalJson(path.join(jobRoot,'released.json')))continue;
      const journal=await optionalJson(path.join(jobRoot,'job.json'));
      if(!journal || journal.version!==1 || journal.job!==job || !Array.isArray(journal.keys) || !Array.isArray(journal.workspaceKeys) || !Array.isArray(journal.searchKeys) || journal.stageName!==`update-${job}`) throw new Error('DOCUMENT_UPDATE_RECOVERY_UNVERIFIED');
      let ownerToken=null;
      if(journal.ownerEvidence==='flock') {
        if(process.platform!=='linux' || !journal.owner?.token)throw new Error('DOCUMENT_UPDATE_OWNER_UNVERIFIED');
        await fs.stat(path.join(jobRoot,'owner.lock'));
        try{ownerLease=await require('./ownerLease').acquireOwnerLease(jobRoot);}
        catch(error){if(error.message==='DOCUMENT_UPDATE_OWNER_ACTIVE')continue;throw error;}
        // A helper failure must not let another recovery race a live writer.
        // This installation supports one app process; matching-host liveness
        // remains an independent check even after obtaining the kernel lease.
        if(journal.owner.host===processOwner.host && !pending.has(job) && !await ownerHasExited(JSON.stringify(journal.owner)))continue;
        ownerToken=journal.owner.token;
      } else if(!(pending.has(job)&&journal.owner?.token===processOwner.token) && !await ownerHasExited(JSON.stringify(journal.owner)))continue;
      deps ||= defaults();
      if(deps.provider!=='chroma')throw new Error('CHROMA_REQUIRED');
      const guard=deps.guard||defaultGuard;
      const snapshot=await optionalJson(path.join(jobRoot,'rollback.json'));
      const committed=await optionalJson(path.join(jobRoot,'committed.json'));
      const finished=await optionalJson(path.join(jobRoot,'finished.json'));
      let keys=[...journal.keys,...journal.searchKeys];
      if(finished) {
        const existing=[];
        for(const key of keys) {
          const scoped=guard.scoped([key])[0];
          try {if(await fs.readFile(path.join(scoped.lock,'job'),'utf8')===job)existing.push(key);}
          catch(error){if(error.code!=='ENOENT')throw error;}
        }
        keys=existing;
      }
      const finish=(deps.answerCacheRuntime||require('../answerCacheRuntime')).beginMutation([journal.workspace.id]);
      try {
        const repair=async()=>guard.owned(async()=>{
          ownerLease?.assertActive();
          if(finished) {
            if(finished.job!==job)throw new Error('DOCUMENT_UPDATE_RECOVERY_UNVERIFIED');
            await guard.releaseJobReaders(job,journal.workspaceKeys,{ownerToken});
            return true;
          }
          const {client}=await deps.vector.connect();
          if(snapshot) {
            if(snapshot.job!==job || snapshot.workspace.id!==journal.workspace.id)throw new Error('DOCUMENT_UPDATE_RECOVERY_UNVERIFIED');
            const live=await client.getCollection({name:deps.vector.normalize(journal.workspace.slug)});
            if(committed) {
              if(committed.job!==job)throw new Error('DOCUMENT_UPDATE_RECOVERY_UNVERIFIED');
              await verifyDatabase(deps,snapshot,true);
              await verifySearch(deps,live,snapshot,true);
            } else await restoreSnapshot(deps,live,snapshot,jobRoot);
          } else if(committed)throw new Error('DOCUMENT_UPDATE_RECOVERY_UNVERIFIED');
          const prepared=[];
          for(const name of await fs.readdir(jobRoot))if(/^prepared-[a-f0-9-]{36}\.json$/.test(name)) {
            const entry=await optionalJson(path.join(jobRoot,name));
            if(name!==`prepared-${entry?.docId}.json`)throw new Error('DOCUMENT_UPDATE_RECOVERY_UNVERIFIED');
            prepared.push(entry.docId);
          }
          if(!committed)await deps.prisma.document_vectors.deleteMany({where:{docId:{in:prepared}}});
          // Missing stage is an expected result of an earlier cleanup attempt.
          try {await client.deleteCollection({name:journal.stageName});}
          catch(error) {if(!isMissingCollection(error))throw error;}
          await guard.releaseJobReaders(job,journal.workspaceKeys,{ownerToken});
          ownerLease?.assertActive();
          await marker(jobRoot,'finished.json',job);
          return true;
        },keys.length?keys:undefined);
        if(keys.length)await guard.recover(job,keys,repair,{ownerToken});
        else await repair();
        await marker(jobRoot,'released.json',job);
        pending.get(job)?.();pending.delete(job);
        result.recovered.push(job);
      } finally {finish();}
    } catch(error) {result.failed.push({job,code:error.message});}
    finally{if(ownerLease)await ownerLease.release();}
  }
  return result;
}
let timer=null, running=false;
function startRecovery() {
  if(timer)return;
  const run=async()=>{
    if(running)return;
    running=true;
    try {
      const result=await recoverDocumentUpdates();
      if(result.failed.length)console.error('[DocumentUpdate] 복구 확인 필요:',result.failed);
    } catch(error){console.error('[DocumentUpdate] 복구 확인 실패:',error.message);}
    finally{running=false;}
  };
  void run();timer=setInterval(run,15000);timer.unref();
}
module.exports={recoverDocumentUpdates,retainRecovery,startRecovery};
