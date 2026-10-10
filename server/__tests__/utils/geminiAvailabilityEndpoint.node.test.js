const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createMonitor } = require('../../utils/geminiAvailability');

function setup(role='admin') {
  const root=path.resolve(__dirname,'../..');
  function load(file,deps) {
    const module={exports:{}};
    vm.runInNewContext(fs.readFileSync(path.join(root,file),'utf8'),{
      module,exports:module.exports,console,process:{env:{NODE_ENV:'production'}},
      require:name=>{if(name in deps)return deps[name];throw new Error(`Unexpected dependency: ${name}`);},
    });
    return module.exports;
  }
  const user={id:1,role,suspended:false,must_change_password:false};
  const http={decodeJWT:token=>token==='synthetic'?{id:1}:null,userFromSession:async(_,res)=>res.locals.user,multiUserMode:res=>res.locals.multiUserMode};
  const system={SystemSettings:{isMultiUserMode:async()=>true}};
  const validated=load('utils/middleware/validatedRequest.js',{
    '../../models/systemSettings':system,'../../models/user':{User:{get:async()=>user}},
    '../EncryptionManager':{EncryptionManager:class{}},'../http':http,'../userLocale':{UserMetaCache:{setFromRequest(){}}},
  });
  const roles=load('utils/middleware/multiUserProtected.js',{'../../models/systemSettings':system,'../http':http});
  const monitor=createMonitor(()=>1000);let handlers;
  load('endpoints/geminiAvailability.js',{
    '../utils/middleware/validatedRequest':validated,'../utils/middleware/multiUserProtected':roles,'../utils/geminiAvailability':{monitor},
  }).geminiAvailabilityEndpoints({get(route,...items){assert.equal(route,'/schat-admin/gemini-availability');handlers=items.flat();}});
  return {monitor,async invoke(token){
    const res={locals:{},statusCode:200,headers:{},set(key,value){this.headers[key]=value;return this;},status(code){this.statusCode=code;return this;},sendStatus(code){this.statusCode=code;return this;},json(body){this.body=body;return this;},send(body){this.body=body;return this;},end(){return this;}};
    for(const handler of handlers){let next=false;await handler({header:()=>token},res,()=>next=true);if(!next)break;}
    return res;
  }};
}
test('unauthenticated and employee access are rejected',async()=>{
  assert.equal((await setup().invoke()).statusCode,401);
  assert.equal((await setup('default').invoke('Bearer synthetic')).statusCode,401);
});
test('admin sees first occurrence only, and successful matching call clears it',async()=>{
  const {monitor,invoke}=setup();
  await assert.rejects(monitor.wrap(async()=>{throw {status:429,message:'daily quota exceeded; private data'}},'private-model')());
  const res=await invoke('Bearer synthetic');
  assert.equal(res.statusCode,200);assert.equal(res.headers['Cache-Control'],'no-store');
  assert.equal(JSON.stringify(res.body),' {"alerts":[{"firstOccurredAt":"1970-01-01T00:00:01.000Z"}]}'.trim());
  await monitor.wrap(async()=>({choices:[{}]}),'private-model')();
  assert.equal((await invoke('Bearer synthetic')).body.alerts.length,0);
});
