const test = require('node:test');
const assert = require('node:assert/strict');
const { computeUsageStats } = require('../../../utils/schatAdmin/usageStats');
const now = new Date('2026-10-10T12:00:00Z');
const users = Array.from({length: 10}, (_, i) => ({id:i+1, department_id:i<5?10:20}));
const departments = [{id:10,name:'가상 A부서'},{id:20,name:'가상 B부서'}];
const row = (user_id, date, tokens=10) => ({user_id, createdAt:date, prompt:'가상 질문', response:JSON.stringify({text:'답변',sources:[],metrics:{prompt_tokens:tokens,completion_tokens:2}})});
const base = {now,users,departments,period:'custom',startDate:'2026-10-01',endDate:'2026-10-02',departmentIds:[10]};
test('custom dates include both Korean calendar days and only selected departments',()=>{
  const chats = users.map(u=>row(u.id,'2026-10-01T01:00:00Z'));
  chats.push(row(1,'2026-09-30T14:59:59Z'),row(1,'2026-09-30T15:00:00Z'),row(1,'2026-10-02T14:59:59.999Z'),row(1,'2026-10-02T15:00:00Z'));
  const before=JSON.stringify(chats);
  const result=computeUsageStats({...base,chats});
  assert.equal(result.questions.total,7);
  assert.deepEqual(result.questions.daily,[{date:'2026-10-01',count:6},{date:'2026-10-02',count:1}]);
  assert.equal(result.aiUsage.promptTokens,70);
  assert.equal(result.searchFailures.total,7);
  assert.equal(JSON.stringify(chats),before);
});
test('two departments combine while other users and null accounts are excluded',()=>{
  const chats=[...users.map(u=>row(u.id,'2026-10-01T01:00:00Z')),row(null,'2026-10-01T01:00:00Z')];
  const result=computeUsageStats({...base,chats,departmentIds:[10,20]});
  assert.equal(result.questions.total,10);
  assert.equal(result.aiUsage.promptTokens,100);
});
test('invalid dates, reversed range and invalid department selection are rejected',()=>{
  for(const change of [{startDate:'2026-02-30'},{endDate:'2026-09-01'},{startDate:''},{departmentIds:['bad']},{departmentIds:[999]}])
    assert.throws(()=>computeUsageStats({...base,...change}), /./);
});
test('a selected department with fewer than five users exposes no aggregate or question details',()=>{
  const result=computeUsageStats({...base,chats:[row(1,'2026-10-01T01:00:00Z')]});
  assert.equal(result.suppressed,true);
  assert.equal(result.questions,undefined);
  assert.equal(result.aiUsage,undefined);
});
test('old custom periods retain counts but never expose question text older than 90 days',()=>{
  const result=computeUsageStats({...base,startDate:'2026-01-01',endDate:'2026-01-01',departmentIds:[],chats:[row(1,'2026-01-01T01:00:00Z')]});
  assert.equal(result.searchFailures.total,1);
  assert.deepEqual(result.searchFailures.items,[]);
});
test('future dates and excessive ranges are rejected; empty selection returns zero safely',()=>{
  for(const change of [{endDate:'2026-10-11'},{startDate:'2024-01-01'}]) assert.throws(()=>computeUsageStats({...base,...change}));
  assert.equal(computeUsageStats({...base,chats:[]}).questions.total,0);
});
test('loader caches each department and range separately and only reads the database',async()=>{
  const prismaPath=require.resolve('../../../utils/prisma');
  const previous=require.cache[prismaPath];
  const {loadUsageStats,clearUsageStatsCache}=require('../../../utils/schatAdmin/usageStats');
  const queries=[];
  require.cache[prismaPath]={exports:{
    workspace_chats:{findMany:async args=>{queries.push(args);return users.map(u=>row(u.id,'2026-10-01T01:00:00Z',u.id<=5?10:20));}},
    users:{findMany:async()=>users},schat_departments:{findMany:async()=>departments},workspace_documents:{findMany:async()=>[]}
  }};
  clearUsageStatsCache();
  try {
    const a=await loadUsageStats('custom',base);
    const b=await loadUsageStats('custom',{...base,departmentIds:[20]});
    assert.equal(a.aiUsage.promptTokens,50);
    assert.equal(b.aiUsage.promptTokens,100);
    assert.equal((await loadUsageStats('custom',base)).aiUsage.promptTokens,50);
    assert.equal(queries.length,2);
    assert.equal(queries[0].where.createdAt.gte.toISOString(),'2026-09-30T15:00:00.000Z');
    assert.equal(queries[0].where.createdAt.lt.toISOString(),'2026-10-02T15:00:00.000Z');
    assert.deepEqual(a.availableDepartments,departments);
  } finally {clearUsageStatsCache();if(previous) require.cache[prismaPath]=previous;else delete require.cache[prismaPath];}
});
