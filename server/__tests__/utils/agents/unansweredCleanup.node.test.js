const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
function load() {
  const queries=[];
  const sandbox={module:{exports:{}},console,require(name){
    if(name==='../utils/prisma') return {$executeRaw:async(parts,...values)=>{queries.push({sql:parts.join('?'),values});return 1;}};
    return {safeJSONStringify:JSON.stringify};
  }};
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname,'../../../models/workspaceChats.js'),'utf8'),sandbox);
  return {chats:sandbox.module.exports.WorkspaceChats,queries};
}
test('unanswered cleanup binds id and empty response in one conditional statement',async()=>{
  const {chats,queries}=load();
  assert.equal(await chats.deleteUnanswered(17),true);
  assert.equal(queries.length,1);
  assert.equal(queries[0].sql,'DELETE FROM workspace_chats WHERE id = ? AND response = ?');
  assert.deepEqual(queries[0].values,[17,'{}']);
});
test('invalid ids never issue a cleanup write',async()=>{
  const {chats,queries}=load();
  for(const id of [null,0,-1,1.2,'17',NaN]) assert.equal(await chats.deleteUnanswered(id),false);
  assert.equal(queries.length,0);
});
