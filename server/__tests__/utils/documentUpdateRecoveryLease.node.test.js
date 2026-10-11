const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const {fork}=require('node:child_process');
const {randomUUID}=require('node:crypto');
const {UpdateGuard,processOwner}=require('../../utils/documentUpdates/guard');
const {durableJson}=require('../../utils/documentUpdates/service');
const {recoverDocumentUpdates}=require('../../utils/documentUpdates/recovery');
function deps(root,connect=async()=>({client:{deleteCollection:async()=>{}}})) {
  return {root,provider:'chroma',guard:new UpdateGuard(path.join(root,'guard')),
    vector:{connect},prisma:{document_vectors:{deleteMany:async()=>{}}},answerCacheRuntime:{beginMutation:()=>()=>{}}};
}
if(process.argv[2]==='lease-worker') {
  // Patch before requiring the guard in a fresh process via the launcher below.
  const [root,job,phase]=process.argv.slice(3);
  setInterval(()=>{},1000);
  const pause=async()=>{process.send('ready');await new Promise(()=>{});};
  (async()=>{
    if(phase==='prepare') {
      const jobRoot=path.join(root,'document-updates',job);
      await fs.mkdir(jobRoot,{recursive:true});
      const lease=await require('../../utils/documentUpdates/ownerLease').acquireOwnerLease(jobRoot);
      await durableJson(path.join(jobRoot,'job.json'),{version:1,job,owner:processOwner,ownerEvidence:lease.kind,
        workspace:{id:1,slug:'test'},keys:['document:guide.pdf'],workspaceKeys:['workspace:1'],searchKeys:['search:test'],stageName:`update-${job}`});
      await deps(root).guard.acquireRead(job,['workspace:1']);
      await deps(root).guard.acquire(job,['document:guide.pdf']);
      await pause();
    } else {
      const result=await recoverDocumentUpdates(deps(root,pause));
      throw Error(JSON.stringify(result));
    }
  })().catch(e=>{console.error(e);process.exit(1);});
} else test('Linux 복구가 새 검색 잠금을 만든 뒤 강제 종료되어도 변경된 호스트명에서 커널 증명으로 재복구한다',{skip:process.platform!=='linux'},async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'schat-recovery-lease-')),job=randomUUID();
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  async function start(phase) {
    const source=`require('node:os').hostname=()=>${JSON.stringify(`isolated-${phase}`)};process.argv=[process.argv[0],process.argv[1],'lease-worker',...process.argv.slice(2)];require(process.argv[1]);`;
    const child=fork(__filename,[root,job,phase],{execArgv:['-e',source],stdio:['ignore','ignore','pipe','ipc']});
    t.after(()=>{if(child.exitCode===null)child.kill('SIGKILL');});
    let errors='';child.stderr.on('data',s=>errors+=s);
    await new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{child.kill('SIGKILL');reject(Error(`timeout ${errors}`));},10000);
      child.once('message',()=>{clearTimeout(timer);resolve();});
      child.once('exit',code=>{clearTimeout(timer);reject(Error(`exit ${code}: ${errors}`));});
    });
    return child;
  }
  const kill=child=>new Promise(resolve=>{child.once('exit',resolve);child.kill('SIGKILL');});
  const original=await start('prepare');
  assert.deepEqual(await recoverDocumentUpdates(deps(root)),{recovered:[],failed:[]});
  await kill(original);
  const recovery=await start('repair');
  const guard=deps(root).guard;
  const owner=JSON.parse(await fs.readFile(path.join(guard.scoped(['search:test'])[0].lock,'owner'),'utf8'));
  assert.equal(owner.recoveryFor.job,job);
  assert.equal(owner.host,'isolated-repair');
  assert.deepEqual(await recoverDocumentUpdates(deps(root)),{recovered:[],failed:[]});
  await kill(recovery);
  const result=await recoverDocumentUpdates(deps(root));
  assert.deepEqual(result,{recovered:[job],failed:[]});
  const release=await guard.acquire('next',['document:guide.pdf','workspace:1','search:test']);await release();
});
