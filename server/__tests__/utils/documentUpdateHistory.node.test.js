const test=require('node:test');
const assert=require('node:assert/strict');
test('보관된 출처는 과거 답변에 남지만 새 검색 근거로 다시 채워지지 않는다',async()=>{
  const {filterArchivedHistory}=require('../../utils/documentUpdates/searchSnapshot');
  const history=[{id:1,response:JSON.stringify({text:'과거 답변',sources:[{document_id:'old',text:'구본'},{document_id:'current',text:'현행'}]})}];
  const prisma={workspace_documents:{findMany:async()=>[{docId:'old-row',docpath:'folder/old.json',metadata:JSON.stringify({document_id:'old',schat_document_update_archived:true})}]}};
  const result=await filterArchivedHistory({id:1},history,prisma);
  assert.deepEqual(JSON.parse(result[0].response).sources,[{document_id:'current',text:'현행'}]);
  assert.equal(JSON.parse(history[0].response).sources.length,2);
  assert.equal(JSON.parse(result[0].response).text,'과거 답변');
});
