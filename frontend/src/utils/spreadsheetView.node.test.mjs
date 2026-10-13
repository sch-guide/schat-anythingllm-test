import test from "node:test";
import assert from "node:assert/strict";
import {sheetColumnName,sheetEvidenceRows,verifiedSheetEvidenceRows,sourceSheetEvidenceQuotes,verifiedSheetEvidenceCells,verifiedSheetEvidenceText,sheetTextHighlightParts,fitSheetScale,firstVisibleEvidenceTarget} from "./spreadsheetView.js";
test("열 이름과 검증 인용의 원본 행 번호만 계산",()=>{
 assert.deepEqual([0,25,26,51,79].map(sheetColumnName),["A","Z","AA","AZ","CB"]);
 assert.deepEqual(sheetEvidenceRows(["행 152: 센터: 가상부 | 내선번호: 0123\n행 153 (묶음 2): 성명: 가나다 | 단축번호: 4567","153","행 0: 없음"]),[152,153]);
});
test("다른 시트나 행 내용이 다른 경우 같은 행 번호라도 표시하지 않음",()=>{
 const data={sheet:"연락처",rows:[{row:2,cells:["가나다","0123"]}]};
 const quotes=["행 2: 성명: 가나다 | 내선번호: 0123"];
 assert.deepEqual(verifiedSheetEvidenceRows(data,"연락처",quotes),[2]);
 assert.deepEqual(verifiedSheetEvidenceRows({...data,sheet:"다른시트"},"연락처",quotes),[]);
 assert.deepEqual(verifiedSheetEvidenceRows(data,"연락처",["행 2: 성명: 가나다 | 내선번호: 01234"]),[]);
 assert.deepEqual(verifiedSheetEvidenceRows(data,"",quotes),[]);
});
test("단축·내선 번호 순서가 바뀌거나 빈칸 위치가 달라지면 표시하지 않음",()=>{
 const data={sheet:"연락처",rows:[{row:2,cells:["가나다","0123","4567"]}]};
 assert.deepEqual(verifiedSheetEvidenceRows(data,"연락처",["행 2: 성명: 가나다 | 단축번호: 4567 | 내선번호: 0123"]),[]);
 assert.deepEqual(verifiedSheetEvidenceRows(data,"연락처",["행 2: 성명: 가나다 | 단축번호: 0123 | 내선번호: 4567"]),[2]);
 const blank={sheet:"연락처",rows:[{row:2,cells:["가나다","","4567"]}]};
 assert.deepEqual(verifiedSheetEvidenceRows(blank,"연락처",["행 2: 성명: 가나다 | 단축번호: [빈 칸] | 내선번호: 4567"]),[2]);
 assert.deepEqual(verifiedSheetEvidenceRows(blank,"연락처",["행 2: 성명: 가나다 | 단축번호: 4567 | 내선번호: [빈 칸]"]),[]);
});

test("행 번호 없는 직접 인용은 출처 행과 대조해 위치·셀만 복원",()=>{
 const source={section:"시트: Sheet1",text:"행 152: 층: 지상3층 | 센터: 간호부 | 실 명칭: 간호교육파트 교대제 | 내선번호: 6741\n행 153: 층: [빈 칸] | 센터: [빈 칸] | 실 명칭: 간호교육파트장 | 내선번호: 2834",evidenceQuotes:["간호교육파트 교대제 | 내선번호: 6741"]};
 const quotes=sourceSheetEvidenceQuotes(source);
 assert.deepEqual(sheetEvidenceRows(quotes),[152]);
 const data={sheet:"Sheet1",rows:[{row:152,cells:["지상3층","간호부","간호교육파트 교대제","6741"]},{row:153,cells:["","","간호교육파트장","2834"]}]};
 assert.deepEqual(verifiedSheetEvidenceCells(data,"Sheet1",quotes),[{row:152,column:2},{row:152,column:3}]);
 assert.deepEqual(verifiedSheetEvidenceCells(data,"다른시트",quotes),[]);
 assert.deepEqual(sourceSheetEvidenceQuotes({...source,evidenceQuotes:["6741"]}),[]);
 assert.deepEqual(sourceSheetEvidenceQuotes({...source,text:source.text+"\n행 180: 실 명칭: 간호교육파트 교대제 | 내선번호: 6741"}),[]);
});

test("값이 같아도 단축·내선 열 이름을 바꾼 인용은 복원하지 않음",()=>{
 const source={text:"행 2: 성명: 가나다 | 단축번호: 0123 | 내선번호: 4567",evidenceQuotes:["성명: 가나다 | 내선번호: 0123 | 단축번호: 4567"]};
 assert.deepEqual(sourceSheetEvidenceQuotes(source),[]);
 assert.deepEqual(sourceSheetEvidenceQuotes({...source,evidenceQuotes:["행 2: 성명: 가나다 | 내선번호: 0123 | 단축번호: 4567"]}),[]);
});

test("너비 맞춤은 65~80% 사이로 축소하고 넓은 표는 스크롤 여지를 남김",()=>{
 assert.equal(fitSheetScale(1000,600),.8);assert.equal(fitSheetScale(708,1000),.7);assert.equal(fitSheetScale(320,1200),.65);assert.equal(fitSheetScale(0,600),.75);
});
test("직접 인용 중 실제 답변에 쓰인 문자열만 표시하고 셀 일부도 처리",()=>{
 const source={text:"행 152: 층: 지상3층 | 센터: 간호부 | 실 명칭: 간호교육파트 교대제 / 교육담당 | 내선번호: 6741\n행 153: 실 명칭: 다른부서 | 내선번호: 2834",evidenceQuotes:["간호교육파트 교대제 | 내선번호: 6741"]};
 const data={sheet:"Sheet1",rows:[{row:152,cells:["지상3층","간호부","간호교육파트 교대제 / 교육담당","6741"]},{row:153,cells:["다른부서","2834"]}]};
 const quotes=sourceSheetEvidenceQuotes(source),answer="- 간호교육파트 교대제: 6741";
 assert.deepEqual(sheetEvidenceRows(quotes),[152]);
 const selected=verifiedSheetEvidenceText(data,"Sheet1",quotes,answer);
 assert.deepEqual(selected,[{row:152,column:2,texts:["간호교육파트 교대제"]},{row:152,column:3,texts:["6741"]}]);
 assert.deepEqual(sheetTextHighlightParts(data.rows[0].cells[2],selected[0].texts),[{text:"간호교육파트 교대제",highlighted:true},{text:" / 교육담당",highlighted:false}]);
 assert.deepEqual(verifiedSheetEvidenceText(data,"Sheet1",quotes,answer+"\n공통번호: 6741"),selected);
 assert.deepEqual(verifiedSheetEvidenceText(data,"Sheet1",quotes,""),[]);
 assert.deepEqual(verifiedSheetEvidenceText(data,"Sheet1",quotes,"다른부서: 2834"),[]);
 assert.deepEqual(sheetTextHighlightParts("16741",["6741"]),[{text:"16741",highlighted:false}]);
});

test("답변 도입문의 부서명이 아니라 실제 목록 항목만 형광펜 표시",()=>{
 const data={sheet:"Sheet1",rows:[{row:152,cells:["간호부","간호교육파트 교대제","6741"]}]};
 const quote="행 152: 센터: 간호부 | 실 명칭: 간호교육파트 교대제 | 내선번호: 6741";
 const selected=verifiedSheetEvidenceText(data,"Sheet1",[quote],"간호부 내선번호는 다음과 같습니다.\n\n* 간호교육파트 교대제: 6741");
 assert.deepEqual(selected.map(cell=>cell.texts),[["간호교육파트 교대제"],["6741"]]);
});

test('큰 원본 글씨의 넓은 표는 읽을 수 있는 범위에서 더 맞춤',()=>{
 assert.equal(fitSheetScale(700,1289,.45),(700-8)/1289);
});

test("여러 줄 업무형태 셀의 첫 문장만 인용해도 행과 번호 근거를 복원",()=>{
 const source={text:"행 142: 과명: 비뇨의학과 | 담당: 가상담당 | 전담간호사: 가상간호사(08) | 단축번호: 1796 | 업무형태: 1개월 간격 파트 변경→당직표 확인\n 평일 상근 D8(08:00~17:00)\n 주말 특근\n행 143: 과명: [빈 칸] | 담당: 다른담당 | 전담간호사: 다른간호사 | 단축번호: 1909 | 업무형태: [빈 칸]",evidenceQuotes:["행 142: 과명: 비뇨의학과 | 담당: 가상담당 | 전담간호사: 가상간호사(08) | 단축번호: 1796 | 업무형태: 1개월 간격 파트 변경→당직표 확인"]};
 const quotes=sourceSheetEvidenceQuotes(source);assert.deepEqual(sheetEvidenceRows(quotes),[142]);
 const data={sheet:"시트1",rows:[{row:142,cells:["비뇨의학과","가상담당","가상간호사(08)","1796","1개월 간격 파트 변경→당직표 확인\n 평일 상근 D8(08:00~17:00)\n 주말 특근"]}]};
 assert.ok(verifiedSheetEvidenceText(data,"시트1",quotes,"* 비뇨의학과 전담간호사: 1796").some(cell=>cell.column===3&&cell.texts.includes("1796")));
});

test("긴 병합 셀의 가운데 부서명보다 위쪽 번호 근거로 이동",()=>{
 assert.equal(firstVisibleEvidenceTarget([{top:300,bottom:320,left:10,right:100},{top:80,bottom:100,left:300,right:350},{top:0,bottom:0,left:0,right:0}]),1);
});
