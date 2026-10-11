const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {createAnswerCache}=require('../../utils/answerCache');

function fixture() {
  const cache=createAnswerCache();
  const state={fail:false,observed:0};
  const row={id:4,workspaceId:1,docId:'synthetic',docpath:'folder/synthetic.json',metadata:'{}'};
  function during() {
    state.observed++;
    assert.equal(cache.get(1,'CT'),null,'old answer visible during document mutation');
    assert.equal(cache.put({workspaceId:1,question:'during',generation:cache.generation(1),value:{answer:'unsafe'}}),false);
    if(state.fail)throw new Error('synthetic mutation failure');
  }
  const deps={uuid:{v4:()=> 'fake-id'},'../utils/prisma':{workspace_documents:{findMany:async()=>[],findFirst:async()=>row,
    create:async()=>{during();return row;},update:async()=>{during();return row;},
    delete:async()=>during(),deleteMany:async()=>during(),updateMany:async()=>during()},
    document_vectors:{deleteMany:async()=>{}},workspaces:{delete:async()=>during()}},
    '../utils/helpers':{getVectorDbClass:()=>({addDocumentToNamespace:async()=>{during();return{vectorized:true};},deleteDocumentFromNamespace:async()=>during()})},
    '../utils/files':{fileData:async()=>({pageContent:'synthetic',title:'synthetic'})},
    '../utils/EmbeddingWorkerManager':{emitProgress:()=>{}},
    './telemetry':{Telemetry:{sendTelemetry:async()=>{}}},'./eventLogs':{EventLogs:{logEvent:async()=>{}}},
    '../endpoints/utils':{getModelTag:()=> 'fake'},'./systemSettings':{SystemSettings:{}},
    '../utils/answerCacheRuntime':{cache,beginMutation:ids=>cache.beginMutation(ids)},
    '../utils/documentUpdates/guard':{guard:{read:operation=>operation()}},
    '../utils/documentUpdates/scopes':{workspaceKey:id=>`workspace:${id}`,pathKeys:async paths=>paths.map(value=>`document:${value}`)},
    // These fixtures use active synthetic documents and already canonical paths.
    // Keep unfinished archive implementation out of the independent cache test.
    '../utils/documentUpdates/archive':{
      isArchivedDocument:()=>false,canonicalDocumentPath:value=>value,
    },
  };
  function load(relative) {
    const sandbox={module:{exports:{}},require:name=>deps[name] || {},process:{env:{}},global:{},console:{error(){}}};
    vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../../models',relative),'utf8'),sandbox);
    return sandbox.module.exports;
  }
  const {Document}=load('documents.js');deps['./documents']={Document};
  const {Workspace}=load('workspace.js');
  cache.put({workspaceId:1,question:'CT',generation:0,value:{answer:'old'}});
  cache.put({workspaceId:2,question:'CT',generation:0,value:{answer:'other'}});
  return{cache,state,Document,Workspace};
}
test('registration, removal, pin update, bulk document changes and workspace deletion block old answers throughout the mutation',async()=>{
  const actions=[f=>f.Document.addDocuments({id:1,slug:'synthetic'},['folder/synthetic.json']),
    f=>f.Document.removeDocuments({id:1,slug:'synthetic'},['folder/synthetic.json']),
    f=>f.Document.update(4,{pinned:true}),f=>f.Document.delete({workspaceId:1}),
    f=>f.Document._updateAll({workspaceId:1},{pinned:false}),f=>f.Workspace.delete({id:1})];
  for(const action of actions) {
    const f=fixture();const before=f.cache.generation(1);
    await action(f);
    assert.ok(f.state.observed>0);assert.equal(f.cache.get(1,'CT'),null);
    assert.ok(f.cache.get(2,'CT'),'unrelated workspace should remain cached');
    assert.equal(f.cache.put({workspaceId:1,question:'late',generation:before,value:{answer:'late'}}),false);
  }
});
test('failed document writes still evict unsafe answers and release the cache mutation gate',async()=>{
  const f=fixture();f.state.fail=true;
  assert.equal(await f.Document.delete({workspaceId:1}),false);
  assert.equal(f.cache.get(1,'CT'),null);
  assert.equal(f.cache.put({workspaceId:1,question:'fresh',generation:f.cache.generation(1),value:{answer:'fresh'}}),true);
});
