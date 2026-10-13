import test from "node:test";
import assert from "node:assert/strict";
import {textEvidenceParts} from "./textEvidenceHighlight.js";
test("인용된 엑셀 행만 표시하고 이름·번호·공백·다른 행은 그대로 보존",()=>{
 const text="행 2: 성명: 가나다 | 내선번호: 0123\n행 3: 성명: 라마바 | 내선번호: 4567";
 const parts=textEvidenceParts(text,["성명: 가 나 다 | 내선번호: 0123"]);
 assert.equal(parts.map(p=>p.text).join(""),text);
 assert.equal(parts.filter(p=>p.highlighted).map(p=>p.text).join(""),"성명: 가나다 | 내선번호: 0123");
 assert.ok(parts.find(p=>!p.highlighted&&p.text.includes("4567")));
});
test("중복·위조·빈 인용·숫자만으로는 표시하지 않음",()=>{
 for(const quotes of [[],["0123"],["성명: 가나다 내선번호: 9999"]])
  assert.ok(textEvidenceParts("성명: 가나다 내선번호: 0123",quotes).every(p=>!p.highlighted));
 assert.ok(textEvidenceParts("근거 문장 그대로 근거 문장 그대로",["근거 문장 그대로"]).every(p=>!p.highlighted));
});
