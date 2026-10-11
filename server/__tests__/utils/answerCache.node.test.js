const {test}=require('node:test');
const assert=require('node:assert/strict');
const {normalizeQuestion,createAnswerCache}=require('../../utils/answerCache');

test('only harmless case, spacing and ending question marks share a key',()=>{
  assert.equal(normalizeQuestion(' CT 전 금식? '),normalizeQuestion('ct전금식！'));
  assert.equal(normalizeQuestion(''),null);
  assert.equal(normalizeQuestion(null),null);
});
test('clinical numbers, operators, split numbers and unit case remain distinct',()=>{
  for(const [a,b] of [['0.5 mg','5 mg'],['1 0 mg','10 mg'],['1~3 mg','13 mg'],
    ['-1 mg','1 mg'],['1:2','12'],['10mM','10mm'],['5%','5'],['1/2','12'],
    ['mM 단위란?','mm 단위란?'],['M 농도','m 농도']])
    assert.notEqual(normalizeQuestion(a),normalizeQuestion(b),`${a} / ${b}`);
});
test('workspace isolation and source copies are preserved',()=>{
  const c=createAnswerCache(); const value={answer:'synthetic',sources:[{page:3,title:'test'}]};
  c.put({workspaceId:1,question:'CT?',value,generation:0}); value.sources[0].page=9;
  assert.equal(c.get(2,'CT?'),null);
  const hit=c.get(1,'ct'); assert.equal(hit.sources[0].page,3); hit.sources[0].page=8;
  assert.equal(c.get(1,'CT!').sources[0].page,3);
  assert.equal(c.stats().hits,2);
});
test('document invalidation rejects late answers and preserves other workspaces',()=>{
  const c=createAnswerCache(); const value={answer:'synthetic'};
  c.put({workspaceId:1,question:'a',value,generation:0});
  c.put({workspaceId:2,question:'a',value,generation:0});
  c.invalidate(1);
  assert.equal(c.get(1,'a'),null); assert.ok(c.get(2,'a'));
  assert.equal(c.put({workspaceId:1,question:'a',value,generation:0}),false);
  assert.equal(c.generation(1),1);
});
test('LRU capacity is global, and reading refreshes only the hit',()=>{
  const c=createAnswerCache();
  for(let i=0;i<100;i++) c.put({workspaceId:i%2+1,question:`q${i}`,value:{answer:String(i)},generation:0});
  c.get(1,'q0');
  c.put({workspaceId:1,question:'new',value:{answer:'new'},generation:0});
  assert.equal(c.stats().entries,100); assert.equal(c.get(2,'q1'),null); assert.ok(c.get(1,'q0'));
});
test('admin metadata, individual removal and clearing do not expose mutable values',()=>{
  const c=createAnswerCache({now:()=>1234});
  c.put({workspaceId:1,question:'CT?',value:{answer:'synthetic'},generation:0}); c.get(1,'CT');
  const [entry]=c.list(1); assert.equal(entry.uses,1); assert.equal(entry.createdAt,1234);
  assert.equal(entry.question,'CT?'); assert.equal(c.remove(entry.id),true); assert.equal(c.get(1,'CT'),null);
  c.put({workspaceId:2,question:'other',value:{answer:'synthetic'},generation:0});
  c.clear(); assert.equal(c.stats().entries,0);
});

test('model, prompt, mode and document context must match without object key order sensitivity',()=>{
  const c=createAnswerCache();
  const context={model:'fake-a',prompt:'prompt-a',mode:'query',corpus:'v1'};
  c.put({workspaceId:1,question:'CT?',value:{answer:'synthetic'},generation:0,context});
  assert.equal(c.get(1,'CT?',{...context,model:'fake-b'}),null);
  assert.equal(c.get(1,'CT?',{...context,prompt:'prompt-b'}),null);
  assert.equal(c.get(1,'CT?',{...context,mode:'chat'}),null);
  assert.equal(c.get(1,'CT?',{...context,corpus:'v2'}),null);
  assert.ok(c.get(1,'CT?',{corpus:'v1',mode:'query',prompt:'prompt-a',model:'fake-a'}));
});

test('document mutation blocks hits and late writes until every nested mutation has finished',()=>{
  const c=createAnswerCache();
  c.put({workspaceId:1,question:'CT',value:{answer:'synthetic'},generation:0});
  c.put({workspaceId:2,question:'CT',value:{answer:'other'},generation:0});
  const finish=c.beginMutation([1]);
  const during=c.generation(1);
  assert.equal(c.get(1,'CT'),null);
  assert.ok(c.get(2,'CT'));
  assert.equal(c.put({workspaceId:1,question:'CT',value:{answer:'during'},generation:during}),false);
  const nested=c.beginMutation([1]);
  finish(); finish();
  assert.equal(c.put({workspaceId:1,question:'CT',value:{answer:'nested'},generation:c.generation(1)}),false);
  nested();
  assert.equal(c.put({workspaceId:1,question:'CT',value:{answer:'late'},generation:during}),false);
  assert.equal(c.put({workspaceId:1,question:'CT',value:{answer:'fresh'},generation:c.generation(1)}),true);
});

test('global mutation also blocks new workspaces and invalidates answers born during the change',()=>{
  const c=createAnswerCache();
  const finish=c.beginMutation();
  const generation=c.generation(9);
  assert.equal(c.put({workspaceId:9,question:'CT',value:{answer:'during'},generation}),false);
  finish();
  assert.equal(c.put({workspaceId:9,question:'CT',value:{answer:'late'},generation}),false);
  assert.equal(c.put({workspaceId:9,question:'CT',value:{answer:'fresh'},generation:c.generation(9)}),true);
});
