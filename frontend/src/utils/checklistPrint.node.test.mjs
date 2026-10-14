import test from "node:test";
import assert from "node:assert/strict";
import {buildChecklistPrintDocument, printChecklist} from "./checklistPrint.js";
import {detailKey} from "./checklistTree.js";
const checklist={id:"c",title:"가상 검사",sections:[{id:"s",title:"검사 전",items:[{id:"a",label:"식이",details:["금식","물 확인"],type:"checkable"},{id:"b",label:"단독 확인",details:[],type:"checkable"},{id:"n",label:"목적",details:["설명"],type:"informational"}]}]};
test("모든 항목 순서·세부 체크·단독 체크를 보존하고 큰 항목은 제목만 출력",()=>{
 const checks={[detailKey({checklistId:"c",sectionId:"s"},"a",0)]:true};
 const before=JSON.stringify({checklist,checks});const html=buildChecklistPrintDocument(checklist,checks);
 assert.match(html,/<h3>식이<\/h3>/);assert.match(html,/☑/);assert.match(html,/☐/);assert.match(html,/class="checked"[^>]*>금식/);
 assert.ok(html.indexOf("금식")<html.indexOf("물 확인"));assert.match(html,/단독 확인/);assert.match(html,/설명/);
 assert.equal(JSON.stringify({checklist,checks}),before);
 assert.match(html,/@page\s*\{[^}]*size:\s*A4/);assert.match(html,/text-decoration:\s*line-through/);assert.doesNotMatch(html,/<button|<input|overflow:\s*(auto|scroll)|height:\s*100vh/);
});
test("환자 이름을 가리고 메모와 문서 내용의 HTML을 실행하지 않음",()=>{
 const html=buildChecklistPrintDocument({...checklist,title:'<script>alert(1)</script>'},{},{patient:"홍길동",other:'<img src=x onerror=alert(1)>'});
 assert.match(html,/홍○동/);assert.doesNotMatch(html,/홍길동|<script|<img/);assert.match(html,/&lt;img/);
});

test("긴 체크리스트의 마지막 내용까지 포함",()=>{
 const details=Array.from({length:400},(_,i)=>`가상항목-${i} `+"긴 문장 ".repeat(15));
 const html=buildChecklistPrintDocument({...checklist,sections:[{id:"long",title:"모든 내용",items:[{id:"x",label:"확인",details}]}]});
 for(let i=0;i<400;i++)assert.ok(html.includes(`가상항목-${i} `));
 assert.doesNotMatch(html,/max-height|overflow:\s*hidden|break-inside:\s*avoid/);
});
test("인쇄 프레임 출력과 완료 후 제거",async()=>{
 let removed=0, printed=0, focused=0, handler;
 const frame={dataset:{},style:{},setAttribute(){},remove(){removed++},contentDocument:{fonts:{ready:Promise.resolve()}},contentWindow:{addEventListener(event,fn){assert.equal(event,"afterprint");handler=fn},focus(){focused++},print(){printed++}}};
 const doc={querySelector(){return null},createElement(tag){assert.equal(tag,"iframe");return frame},body:{appendChild(f){assert.equal(f,frame)}}};
 printChecklist(checklist,{}, {},doc);assert.match(frame.srcdoc,/가상 검사/);await frame.onload();assert.equal(printed,1);assert.equal(focused,1);handler();assert.equal(removed,1);
});
