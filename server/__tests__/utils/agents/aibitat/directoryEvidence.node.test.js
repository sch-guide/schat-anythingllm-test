const test = require("node:test");
const assert = require("node:assert/strict");
const { directoryEntries, directoryAnswer } = require("../../../../utils/agents/aibitat/utils/directoryEvidence");
const cell = (str, x, y, w = 18) => ({ str, x, y, w, h: 7 });
const layout = { items: [
  cell("성명", 10, 110), cell("단축", 40, 110), cell("내선", 70, 110),
  cell("성명", 110, 110), cell("단축", 140, 110), cell("내선", 170, 110),
  cell("가 나 다", 10, 100), cell("1234", 40, 100), cell("5678", 70, 100),
  cell("라 마 바", 110, 100), cell("9012", 140, 100), cell("3456", 170, 100),
  cell("사 아 자", 10, 90), cell("7777", 40, 90), cell("8888", 70, 90),
] };
const original = "가나다 1234 5678 라마바 9012 3456 사아자 7777 8888";
test("같은 행·열 머리글로 단축과 내선을 구분하고 옆 사람·아래 행은 제외", () => {
  const rows = directoryEntries(layout, "가나다 내선번호", original);
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0].numbers, [{ label: "단축", value: "1234" }, { label: "내선", value: "5678" }]);
  assert.equal(rows[0].quote.replace(/\s/g, ""), "가나다12345678");
  const source = { documentName: "전화번호부.pdf", text: original, directoryEntries: rows };
  assert.equal(directoryAnswer([source], "가나다 내선번호").text, "가나다님의 내선번호는 5678입니다.");
  assert.equal(directoryAnswer([source], "가나다 단축번호").text, "가나다님의 단축번호는 1234입니다.");
  assert.match(directoryAnswer([source], "가나다 전화번호").text, /단축번호: 1234[\s\S]*내선번호: 5678/);
});
test("머리글 없음·다른 검색근거·이름 일부 일치에는 번호 종류를 추측하지 않음", () => {
  assert.deepEqual(directoryEntries({ items: layout.items.slice(6) }, "가나다 내선번호", original), []);
  assert.deepEqual(directoryEntries(layout, "가나 내선번호", original), []);
  assert.deepEqual(directoryEntries(layout, "가나다 내선번호", "라마바 9012 3456"), []);
  assert.equal(directoryAnswer([], "가나다 내선번호"), null);
});
test("성명 머리글이 비어 있어도 번호 열의 명시된 머리글로만 구분", () => {
  const missingNameHeader = {items:layout.items.filter(i=>!(i.y===110 && i.x===10))};
  assert.deepEqual(directoryEntries(missingNameHeader,"가나다 내선번호",original)[0]?.numbers,
    [{label:"단축",value:"1234"},{label:"내선",value:"5678"}]);
});
test("겹친 숫자·다른 이름을 함께 묻는 질문·다른 번호 종류는 자동 확정하지 않음", () => {
  const rows = directoryEntries(layout, "가나다 전화번호", original);
  const source = { directoryEntries: rows };
  assert.equal(directoryAnswer([source], "가나다와 라마바 전화번호"), null);
  assert.equal(directoryAnswer([source], "가나다 휴대폰번호"), null);
  assert.deepEqual(directoryEntries({items:[...layout.items, cell("9999", 70, 100)]}, "가나다 내선번호", original), []);
  const other = {directoryEntries: [{...rows[0], numbers:[{label:"내선",value:"0000"}]}]};
  assert.equal(directoryAnswer([source,other], "가나다 내선번호"), null);
});

for (const streaming of [false,true]) test(`검증된 전화번호는 AI 호출 없이 답하고 같은 원문 행을 출처로 남김(stream=${streaming})`, async () => {
  const {completeWithEvidence} = require("../../../../utils/agents/aibitat/utils/evidenceQuotes");
  const sources = [{documentName:"전화번호부.pdf",text:original,page:1,
    directoryEntries:directoryEntries(layout,"가나다 내선번호",original)}];
  let calls = 0;
  const provider = {complete:async()=>{calls++;return {textResponse:"잘못된 번호 1234"};},
    stream:async()=>{calls++;return {textResponse:"잘못된 번호 1234"};}};
  const events=[];
  const result = await completeWithEvidence({provider,sources,
    messages:[{role:"user",content:"가나다 내선번호\n<hospital_document_context>검색된 근거</hospital_document_context>"}],
    eventHandler:streaming ? (type,data)=>events.push(data) : undefined});
  assert.equal(result.textResponse,"가나다님의 내선번호는 5678입니다.");
  assert.equal(calls,0);
  assert.deepEqual(sources[0].evidenceQuotes,[sources[0].directoryEntries[0].quote]);
  if(streaming) assert.equal(events[0].content,result.textResponse);
});
