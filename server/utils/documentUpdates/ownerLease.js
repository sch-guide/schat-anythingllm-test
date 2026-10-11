const path=require('node:path');
const {spawn}=require('node:child_process');
// flock is held by a child whose stdin is the owning Node process's pipe.
// Kernel release after EOF/crash works across container/PID/hostname changes.
async function acquireOwnerLease(jobRoot,{unref=false}={}) {
  if(process.platform!=='linux')return {kind:'process',assertActive(){},release:async()=>{}};
  const filename=path.join(jobRoot,'owner.lock');
  const child=spawn('/usr/bin/flock',['--exclusive','--nonblock',filename,'/bin/sh','-c','printf ready; cat >/dev/null'],{stdio:['pipe','pipe','pipe']});
  let exited=false,closing=false,lost=null;
  child.stdin.on('error',error=>{if(!closing)lost=error;});
  const finished=new Promise(resolve=>child.once('exit',code=>{exited=true;resolve(code);}));
  await new Promise((resolve,reject)=>{
    child.once('error',error=>{lost=error;reject(error);});
    child.once('exit',code=>reject(new Error(code===1?'DOCUMENT_UPDATE_OWNER_ACTIVE':'DOCUMENT_UPDATE_OWNER_UNVERIFIED')));
    child.stdout.once('data',data=>data.toString()==='ready'?resolve():reject(new Error('DOCUMENT_UPDATE_OWNER_UNVERIFIED')));
  });
  if(unref) {
    child.unref();child.stdin.unref();child.stdout.unref();child.stderr.unref();
  }
  return {kind:'flock',assertActive(){if(exited||lost)throw new Error('DOCUMENT_UPDATE_OWNER_UNVERIFIED');},release:async()=>{closing=true;if(!exited)child.stdin.end();await finished;}};
}
module.exports={acquireOwnerLease};
