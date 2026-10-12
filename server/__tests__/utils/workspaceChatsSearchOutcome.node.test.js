const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const outcome = require('../../utils/chatSearchOutcome');

// 실제 DB 연결 대신 저장 경계만 대체하고 모델의 직렬화/수정 로직을 실행한다.
function model(existing) {
  const writes = [];
  const prisma = { workspace_chats: {
    findFirst: async () => existing,
    create: async ({data}) => { writes.push(data); return data; },
    upsert: async ({update,create}) => { const data=existing?update:create; writes.push(data); return {chat:data}; },
  }};
  const sandbox = {module:{exports:{}},console,Date,require(name) {
    if(name === '../utils/prisma') return prisma;
    if(name === '../utils/chatSearchOutcome') return outcome;
    if(name === '../utils/helpers/chat/responses') return {safeJSONStringify:JSON.stringify};
    throw new Error(`Unexpected dependency ${name}`);
  }};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../../models/workspaceChats.js'),'utf8'),sandbox);
  return {api:sandbox.module.exports.WorkspaceChats,writes};
}

test('새 행에는 새 판정 저장, Agent 임시 행은 정확히 빈 JSON 보존', async () => {
  const {api,writes}=model(null);
  await api.new({workspaceId:1,prompt:'테스트',response:{}});
  await api.new({workspaceId:1,prompt:'테스트',response:{text:'안내',sources:[]}});
  assert.equal(writes[0].response,'{}');
  assert.equal(JSON.parse(writes[1].response).searchOutcome.status,'answered');
});

test('Agent 임시 행 완료와 신규 upsert는 새 판정, 옛 완료 기록 수정은 옛 기준 유지', async () => {
  for(const existing of [null,{response:'{}'},{response:'{"text":"옛 답변","sources":[]}'},{response:'{"text":"새 답변","searchOutcome":{"version":2,"status":"answered"}}'}]) {
    const {api,writes}=model(existing);
    await api.upsert(1,{workspaceId:1,prompt:'테스트',response:{text:'새 안내',sources:[],searchOutcome:{version:2,status:'answered'}}});
    const result=JSON.parse(writes[0].response);
    if(existing?.response.includes('옛 답변')) assert.equal(result.searchOutcome,undefined);
    else assert.equal(result.searchOutcome.status,'answered');
  }
});
