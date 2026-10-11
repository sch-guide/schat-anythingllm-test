const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const {spawn}=require('node:child_process');
test('Linux 커널 잠금은 살아 있는 프로세스를 보호하고 강제 종료 후 회수된다',{skip:process.platform!=='linux'},async t=>{
  const {acquireOwnerLease}=require('../../utils/documentUpdates/ownerLease');
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'schat-owner-lease-'));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const modulePath=require.resolve('../../utils/documentUpdates/ownerLease');
  const child=spawn(process.execPath,['-e',`require(process.argv[1]).acquireOwnerLease(process.argv[2]).then(()=>{console.log('ready');setInterval(()=>{},1000);});`,modulePath,root],{stdio:['ignore','pipe','pipe']});
  await new Promise((resolve,reject)=>{child.stdout.once('data',resolve);child.once('exit',code=>reject(new Error(`exit ${code}`)));});
  await assert.rejects(acquireOwnerLease(root),/DOCUMENT_UPDATE_OWNER_ACTIVE/);
  await new Promise(resolve=>{child.once('exit',resolve);child.kill('SIGKILL');});
  let lease;
  for(let attempt=0;attempt<50;attempt++) {
    try{lease=await acquireOwnerLease(root);break;}
    catch(error){if(error.message!=='DOCUMENT_UPDATE_OWNER_ACTIVE')throw error;await new Promise(r=>setTimeout(r,10));}
  }
  assert.ok(lease);
  await lease.release();
});
