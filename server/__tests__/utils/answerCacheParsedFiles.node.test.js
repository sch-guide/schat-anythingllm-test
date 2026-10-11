const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {createAnswerCache}=require('../../utils/answerCache');

function fixture() {
  const cache=createAnswerCache();
  const state={files:[],fail:false,observed:0};
  function observe() {
    state.observed++;
    assert.equal(cache.get(1,'CT'),null);
    assert.equal(cache.put({workspaceId:1,question:'during',generation:cache.generation(1),value:{answer:'unsafe'}}),false);
    if(state.fail)throw new Error('synthetic failure');
  }
  const dependencies={
    '../utils/prisma':{workspace_parsed_files:{
      findMany:async()=>state.files,
      create:async({data})=>{observe();const file={id:7,...data};state.files.push(file);return file;},
      deleteMany:async()=>{observe();const count=state.files.length;state.files=[];return{count};},
    }},
    '../utils/answerCacheRuntime':{beginMutation:ids=>cache.beginMutation(ids)},
    './eventLogs':{EventLogs:{logEvent:async()=>{}}},
    './documents':{},'../utils/files':{},'../utils/http':{},fs:{},path:require('node:path'),
  };
  const sandbox={module:{exports:{}},console:{error(){}},require:name=>{if(!(name in dependencies))throw Error(`Unexpected dependency ${name}`);return dependencies[name];}};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../../models/workspaceParsedFiles.js'),'utf8'),sandbox);
  cache.put({workspaceId:1,question:'CT',generation:0,value:{answer:'old'}});
  cache.put({workspaceId:2,question:'CT',generation:0,value:{answer:'other'}});
  return{cache,state,model:sandbox.module.exports.WorkspaceParsedFiles};
}
test('private file creation and deletion each block reads, reject late answers and preserve other workspaces',async()=>{
  const f=fixture();const before=f.cache.generation(1);
  const result=await f.model.create({filename:'synthetic',workspaceId:'1',userId:1});
  assert.ok(result.file);assert.equal(f.cache.get(1,'CT'),null);assert.ok(f.cache.get(2,'CT'));
  const afterCreate=f.cache.generation(1);
  assert.equal(f.cache.put({workspaceId:1,question:'late',generation:before,value:{answer:'unsafe'}}),false);
  f.cache.put({workspaceId:1,question:'CT',generation:afterCreate,value:{answer:'unrelated old'}});
  assert.equal(await f.model.delete({id:7,userId:1}),true);
  assert.equal(f.cache.get(1,'CT'),null);assert.ok(f.cache.get(2,'CT'));
  assert.equal(f.cache.put({workspaceId:1,question:'late',generation:afterCreate,value:{answer:'unsafe'}}),false);
  assert.equal(f.cache.put({workspaceId:1,question:'fresh',generation:f.cache.generation(1),value:{answer:'fresh'}}),true);
  assert.equal(f.state.observed,2);
});
test('failed personal file writes evict old answers and release mutation gates',async()=>{
  const f=fixture();f.state.fail=true;
  assert.equal((await f.model.create({filename:'synthetic',workspaceId:1})).file,null);
  assert.equal(f.cache.get(1,'CT'),null);
  assert.equal(f.cache.put({workspaceId:1,question:'fresh',generation:f.cache.generation(1),value:{answer:'fresh'}}),true);
});
