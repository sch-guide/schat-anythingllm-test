const test=require('node:test');
const assert=require('node:assert/strict');
const {sheetDepartmentContacts}=require('../../../../utils/agents/aibitat/utils/directoryEvidence');
const data={sheet:'명단',rows:[
 {row:1,cells:['과명','담당','전담간호사','단축번호','업무형태']},
 {row:2,cells:['가상내과','담당가','가나다(20)','1234','상근']},
 {row:3,cells:['','','라마바(14)','5678','']},
 {row:4,cells:['','','대기/분만','','']},
 {row:5,cells:['다른과','담당나','사아자','9999','']},
 {row:6,cells:['','','차카타','8888','']}
],merges:[{s:{r:1,c:0},e:{r:3,c:0},value:'가상내과'}]};
test('붙여쓰기·호칭·알려줘 표현도 같은 전체 명단으로 처리',()=>{
 for(const q of ['가상 전담번호','가상 전담','가상 전담 간호사 연락처 알려주세요','가상 전담 번호 알려줘'])
  assert.equal(sheetDepartmentContacts(data,q)?.contacts.length,2,q);
 const urology={...data,rows:data.rows.map(r=>({...r,cells:r.cells.map(c=>c==='가상내과'?'비뇨의학과':c)})),merges:[{...data.merges[0],value:'비뇨의학과'}]};
 for(const q of ['비뇨기과 전담 번호','비뇨 전담번호','비뇨의학과 전담간호사 연락처'])
  assert.equal(sheetDepartmentContacts(urology,q)?.contacts.length,2,q);
});
test('현재 질문으로 등록된 엑셀을 조회하고 다른 부서·이전 버전은 제외',async()=>{
 const {resolveWorkspaceDepartmentContact}=require('../../../../utils/agents/aibitat/utils/sheetDepartmentContacts');
 const visited=[];
 const prisma={workspace_documents:{findMany:async({where})=>{
  assert.equal(where.workspaceId,7);
  return [{metadata:JSON.stringify({document_id:'current',title:'시험.xlsx',section:'시트: 명단'})},
   {metadata:JSON.stringify({document_id:'old',title:'시험.xlsx',section:'시트: 명단',schat_document_update_archived:true})}];
 }}};
 const enrich=async(source,q)=>{visited.push(source.document_id);const group=sheetDepartmentContacts(data,q);return {...source,text:group.quotes.join('\n'),sheetDepartmentContacts:group};};
 const result=await resolveWorkspaceDepartmentContact?.({id:7,slug:'synthetic'},'가상 전담 번호',{prisma,enrich,snapshot:async(w,fn)=>fn()});
 assert.equal(result?.source.sheetDepartmentContacts.contacts.length,2);
 assert.deepEqual(visited,['current']);
});
test('검색 결과에서 공개 출처·답변까지 전체 명단과 직접 인용을 유지',async()=>{
 const {buildPublicRagSource}=require('../../../../utils/agents/aibitat/utils/ragSources');
 const {completeWithEvidence}=require('../../../../utils/agents/aibitat/utils/evidenceQuotes');
 const group=sheetDepartmentContacts(data,'가상 전담 번호');
 const sources=[buildPublicRagSource({title:'가상연락처.xlsx',section:'시트: 명단',text:group.quotes.join('\n'),sheetDepartmentContacts:group})];
 const result=await completeWithEvidence({sources,messages:[{role:'user',content:'가상 전담 번호'}],provider:{complete(){throw Error('unexpected model call')}}});
 assert.match(result.textResponse,/가나다\(20\): 1234/);
 assert.match(result.textResponse,/라마바\(14\): 5678/);
 assert.doesNotMatch(result.textResponse,/9999|8888/);
 assert.equal(sources[0].evidenceQuotes.length,2);
 for(const quote of sources[0].evidenceQuotes)assert.ok(sources[0].text.includes(quote));
});
test('원본 병합 범위 내 전체 번호를 찾고 이웃 부서는 제외',()=>{
 const before=JSON.stringify(data);
 const result=sheetDepartmentContacts?.(data,'가상 전담 번호');
 assert.deepEqual(result?.contacts.map(c=>[c.name,c.number]),[['가나다(20)','1234'],['라마바(14)','5678']]);
 assert.equal(result?.quotes.length,2);
 assert.match(result.quotes[1],/행 3: 과명: \[빈 칸\]/);
 assert.equal(JSON.stringify(data),before);
});
test('병합되지 않은 빈칸은 앞 부서를 상속하지 않음',()=>{
 assert.deepEqual(sheetDepartmentContacts?.({...data,merges:[]},'가상 전담 번호')?.contacts.map(c=>c.number),['1234']);
});
test('부서가 모호하거나 다른 주제·번호 종류·특정 사람 한정은 자동 목록화하지 않음',()=>{
 for(const q of ['가상 전담 관리 방법','가상 전담 내선번호','가상 전담 가나다 번호','가상 전담 번호 말고 다른과'])assert.equal(sheetDepartmentContacts?.(data,q)??null,null);
 const ambiguous={...data,rows:[...data.rows,{row:7,cells:['가상외과','','파하가','1111','']}]};
 assert.equal(sheetDepartmentContacts?.(ambiguous,'가상 전담 번호')??null,null);
});
