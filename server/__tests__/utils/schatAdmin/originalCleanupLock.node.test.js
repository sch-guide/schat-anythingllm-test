const test=require('node:test'),assert=require('node:assert/strict');
const {withOriginalCleanupLock}=require('../../../utils/schatAdmin/originalCleanupLock');
test('holds only selected document names and never begins deletion when replacement is locked',async()=>{
 const report={groups:[{key:'old',kind:'original',originalName:'시험.pdf'}]};
 let called=false,scopes;
 await assert.rejects(withOriginalCleanupLock(['old'],()=>{called=true;},{loadReport:async()=>report,guard:{read:async(fn,keys)=>{scopes=keys;throw Error('DOCUMENT_UPDATE_LOCKED');}}}),/DOCUMENT_UPDATE_LOCKED/);
 assert.equal(called,false);assert.deepEqual(scopes,['document:시험.pdf']);
 const value=await withOriginalCleanupLock(['old'],()=>42,{loadReport:async()=>report,guard:{read:async fn=>fn()}});
 assert.equal(value,42);
});
test('unknown document names cannot bypass replacement protection',async()=>{
 let called=false;
 await assert.rejects(withOriginalCleanupLock(['old'],()=>{called=true;},{loadReport:async()=>({groups:[{key:'old',kind:'original'}]}),guard:{read:async fn=>fn()}}),/ORIGINAL_SCOPE_UNKNOWN/);
 assert.equal(called,false);
});

test('real replacement guard blocks matching names and releases readers after errors',async()=>{
 const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
 const {UpdateGuard}=require('../../../utils/documentUpdates/guard');
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'schat-original-lock-'));
 const guard=new UpdateGuard(root);
 const report={groups:[{key:'old',kind:'original',originalName:'시험.pdf'}]};
 const options={guard,loadReport:async()=>report};
 try {
  const release=await guard.acquire('synthetic-update',['document:시험.pdf']);
  try {await assert.rejects(withOriginalCleanupLock(['old'],()=>assert.fail('must not delete'),options),/DOCUMENT_UPDATE_LOCKED/);}
  finally {await release();}
  await assert.rejects(withOriginalCleanupLock(['old'],async()=>{throw Error('synthetic failure');},options),/synthetic failure/);
  const again=await guard.acquire('synthetic-next',['document:시험.pdf']);await again();
  const unrelated=await guard.acquire('synthetic-other',['document:다른.pdf']);
  try {assert.equal(await withOriginalCleanupLock(['old'],()=>42,options),42);}
  finally {await unrelated();}
 } finally {await fs.rm(root,{recursive:true,force:true});}
});
