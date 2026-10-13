const test = require("node:test");
const assert = require("node:assert/strict");
const { spreadsheetText } = require("../../processSingleFile/convert/spreadsheetText");
test("전화번호부는 행마다 열 이름을 붙이고 앞자리 0·빈칸·다른 사람을 보존", () => {
  const text = spreadsheetText({name:"연락처",data:[
    ["전화번호부"], ["성명","단축번호","내선번호"],
    ["가나다","0123","5678"], ["라마바",null,"0099"],
  ]});
  assert.match(text,/성명: 가나다 \| 단축번호: 0123 \| 내선번호: 5678/);
  assert.match(text,/성명: 라마바 \| 단축번호: \[빈 칸\] \| 내선번호: 0099/);
  assert.match(text,/전화번호부/);
  assert.doesNotMatch(text,/가나다[^\n]*0099/);
});
test("가로로 반복한 전화번호 표는 사람별 묶음으로 나누며 병합칸을 추측하지 않음", () => {
  const text = spreadsheetText({name:"표",data:[
    ["성명","단축","내선","성명","단축","내선"],
    ["가나다","1234","5678","라마바","9012","3456"],
  ]});
  assert.equal(text.split("\n").filter(s=>s.includes("성명:")).length,2);
  assert.doesNotMatch(text,/가나다[^\n]*라마바/);
});
test("빈 시트는 건너뛰고 숫자 0·제목 없는 열·머리글 없는 자료도 버리지 않음", () => {
  assert.equal(spreadsheetText({name:"빈 시트",data:[[],[null,""]]}),"");
  assert.match(spreadsheetText({name:"자료",data:[["항목",""],["검사",0]]}),/열 B: 0/);
  assert.match(spreadsheetText({name:"제목",data:[["단일 값"]]}),/단일 값/);
});
test("연락처·부서라는 제목 줄은 실제 열 머리글보다 우선하지 않음", () => {
  for(const title of ["연락처","부서"]) {
    const text=spreadsheetText({data:[[title,"",""],["성명","단축번호","내선번호"],["가나다","0123","5678"]]});
    assert.match(text,/성명: 가나다 \| 단축번호: 0123 \| 내선번호: 5678/);
  }
});
