const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
test('Agent close is one parameterized idempotent write for its UUID only', async()=>{
  const calls=[];
  const prisma={$executeRaw:async(strings,...values)=>{calls.push({sql:strings.join('?'),values});return 1;}};
  const sandbox={module:{exports:{}},require:name=>name.includes('prisma')?prisma:{v4:()=> 'unused'},console};
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname,'../../../models/workspaceAgentInvocation.js'),'utf8'),sandbox);
  await sandbox.module.exports.WorkspaceAgentInvocation.close('synthetic-id');
  await sandbox.module.exports.WorkspaceAgentInvocation.close(null);
  assert.equal(calls.length,1);
  assert.match(calls[0].sql,/UPDATE workspace_agent_invocations SET closed = 1 WHERE uuid = \?/);
  assert.deepEqual(calls[0].values,['synthetic-id']);
});
