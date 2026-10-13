const test=require('node:test'),assert=require('node:assert/strict');
const {rankByBm25,fuseGeminiAndBm25}=require('../../utils/vectorDbProviders/chroma/schatBm25');
test('연락처 원본이 일반 문서 400개보다 뒤로 밀리지 않음',()=>{
 const directory={id:'directory',text:'행 152: 센터: 가상부 | 실 명칭: 가상교육 | 내선번호: 6741',metadata:{title:'통합전화번호부.xlsx'}};
 const corpus=[...Array.from({length:400},(_,i)=>({id:'clinical'+i,text:'가상부 전화번호 안내입니다.',metadata:{title:'실무지침서.pdf'}})),directory];
 for(const queryText of ['가상부 전화번호','가상부 번호','가상부 내선번호']){
 const ranked=rankByBm25(queryText,corpus).slice(0,20);
 assert.equal(ranked[0].id,'directory');
 const fused=fuseGeminiAndBm25([{...corpus[0],vectorScore:.9}],ranked,{queryText});
 assert.deepEqual(fused.map(x=>x.id),['directory']);
 }
 const unknown=rankByBm25('없는부 전화번호',corpus).slice(0,20);
 assert.ok(!fuseGeminiAndBm25([],unknown,{queryText:'없는부 전화번호'}).some(x=>x.id==='directory'));
});

test('번호가 없는 전화번호부 안내만으로 실제 번호가 있는 다른 근거를 없애지 않음',()=>{
 const info={id:'info',text:'가상부 담당자는 별도로 문의 바랍니다',metadata:{title:'전화번호부.xlsx'}};
 const actual={id:'actual',text:'가상부 전화번호: 1234',metadata:{title:'안내.pdf'},vectorScore:.95};
 const ranked=rankByBm25('가상부 전화번호',[info,actual]);
 assert.ok(fuseGeminiAndBm25([actual],ranked,{queryText:'가상부 전화번호'}).some(x=>x.id==='actual'));
});

test('전화번호부의 확인된 유사명칭만 확장하고 다른 부서·일반질문은 넓히지 않음',()=>{
 const directory={id:'urology',text:'행 10: 센터: 비뇨의학센터 | 실 명칭: 비뇨의학센터 외래 | 내선번호: 2275',metadata:{title:'통합전화번호부.xlsx'}};
 const unrelated={id:'other',text:'행 11: 센터: 신장센터 | 실 명칭: 신장내과 외래 | 내선번호: 2110',metadata:{title:'통합전화번호부.xlsx'}};
 const clinical={id:'clinical',text:'비뇨의학센터 검사 준비 안내',metadata:{title:'실무지침서.pdf'}};
 for(const queryText of ['비뇨의학과 번호','비뇨기과 번호','비뇨의학센터 번호','비뇨기 번호','비뇨기과번호']){
  const ranked=rankByBm25(queryText,[unrelated,clinical,directory]);
  assert.equal(ranked[0]?.id,'urology',queryText);
  assert.deepEqual(fuseGeminiAndBm25([],ranked,{queryText}).map(x=>x.id),['urology'],queryText);
 }
 assert.deepEqual(fuseGeminiAndBm25([],rankByBm25('소아비뇨기과 번호',[directory,unrelated]),{queryText:'소아비뇨기과 번호'}),[]);
 assert.equal(rankByBm25('비뇨기과',[clinical]).length,0);
});
