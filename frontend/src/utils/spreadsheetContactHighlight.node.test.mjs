import test from 'node:test';
import assert from 'node:assert/strict';
import {verifiedSheetEvidenceText,sheetTextHighlightParts} from './spreadsheetView.js';
const data={sheet:'명단',rows:[{row:2,cells:['가상내과','담당가','가나다(20)','1234','상근']}]};
const quotes=['행 2: 과명: 가상내과 | 담당: 담당가 | 전담간호사: 가나다(20) | 단축번호: 1234 | 업무형태: 상근'];
test('호칭과 입니다가 붙어도 직접 인용된 이름·번호만 강조',()=>{
 const cells=verifiedSheetEvidenceText(data,'명단',quotes,'가상내과 전담간호사(가나다님)의 단축번호는 1234입니다.');
 assert.ok(cells.some(c=>c.column===2&&c.texts.includes('가나다')));
 assert.ok(cells.some(c=>c.column===3&&c.texts.includes('1234')));
 assert.deepEqual(sheetTextHighlightParts('가나다(20)',['가나다']),[{text:'가나다',highlighted:true},{text:'(20)',highlighted:false}]);
});
test('더 긴 이름과 더 긴 번호를 같은 연락처로 강조하지 않음',()=>{
 for(const answer of ['가나다라님: 12345입니다.','차가나다님: 91234입니다.']){
  const cells=verifiedSheetEvidenceText(data,'명단',quotes,answer);
  assert.ok(!cells.some(c=>c.column===2||c.column===3));
 }
});
