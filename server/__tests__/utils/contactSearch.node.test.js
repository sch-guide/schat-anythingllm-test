const test = require("node:test");
const assert = require("node:assert/strict");
const {
  contactQueryVariant,
  buildBodySearchQueries,
  mergeBodySearchResults,
} = require("../../utils/chats/expandedBodySearch");

test("연락처 질문은 연락처 단어를 뺀 검색어를 하나 더 만듦(원래 질문이 먼저)", () => {
  assert.equal(contactQueryVariant("가나다 내선번호"), "가나다");
  assert.equal(contactQueryVariant("시설팀 전화번호 알려줘"), "시설팀");
  assert.equal(contactQueryVariant("원무팀 연락처"), "원무팀");
  assert.equal(contactQueryVariant("전화번호부 알려줘"), null, "남는 단어가 없으면 만들지 않음");
  assert.equal(contactQueryVariant("수혈 절차 알려줘"), null, "연락처 질문이 아니면 그대로");
  assert.deepEqual(buildBodySearchQueries("가나다 전화번호"), ["가나다 전화번호", "가나다"]);
  assert.deepEqual(
    buildBodySearchQueries("수혈 절차 알려줘"),
    ["수혈 절차 알려줘", "수혈 시행 절차", "수혈 준비 확인", "수혈 단계"],
    "다른 질문의 검색어는 바뀌지 않음"
  );
});

test("두 검색 결과를 합쳐도 원래 검색 결과를 잃지 않음", () => {
  const source = (id, text) => ({ id, docId: id, title: id, text });
  const merged = mergeBodySearchResults(
    [{ sources: [source("a", "원래")] }, { sources: [source("b", "추가"), source("a", "원래")] }],
    { limit: 4 }
  );
  assert.deepEqual(merged.sources.map((s) => s.id), ["a", "b"]);
  assert.deepEqual(merged.contextTexts, ["원래", "추가"]);
});

test("에이전트 문서 검색도 연락처 질문이면 한 번 더 검색해 합침", () => {
  const src = require("node:fs").readFileSync(require("node:path").join(__dirname, "../../utils/agents/aibitat/plugins/memory.js"), "utf8");
  assert.match(src, /contactQueryVariant\(query\)/);
  assert.match(src, /mergeBodySearchResults\(\[result, extra\]/);
});
