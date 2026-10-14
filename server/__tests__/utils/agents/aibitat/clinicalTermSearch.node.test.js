// 2026-10-14 검색 누락 보완: 임상 질문의 선행 문서 검색, I&D 약어 단어 인식,
// 검색 오류와 "문서에 없음" 구분, 단계별 시간 기록.
const test = require("node:test");
const assert = require("node:assert/strict");

const {
  shouldForceHospitalRagSearch,
} = require("../../../../utils/agents/aibitat/utils/hospitalDocumentIntent");
const {
  tokenize,
  queryTokens,
  rankByBm25,
} = require("../../../../utils/vectorDbProviders/chroma/schatBm25");
const { startTimer, formatTiming } = require("../../../../utils/schatTiming");

test("한글·영문·약어가 섞인 임상 질문은 답변 전에 문서를 먼저 찾는다", () => {
  for (const question of [
    "정형외과 local block 하 I&D",
    "정형외과 Local block I&D",
    "Local anesthesia I&D",
    "국소마취하 절개 및 배농",
    "I&D 준비 및 간호",
    "중심정맥관 관리",
    "진정절차",
    "Foley 교체 주기",
    "CVC 드레싱",
  ])
    assert.equal(shouldForceHospitalRagSearch(question), true, question);
});

test("일상 대화는 예전처럼 문서 검색 없이 처리한다", () => {
  for (const question of ["오늘 날씨 어때?", "안녕", "hello", "고마워", "점심 메뉴 추천해줘"])
    assert.equal(shouldForceHospitalRagSearch(question), false, question);
});

test("I&D는 한 단어로 인식하고 긴 영문 사이의 &는 그대로 둔다", () => {
  assert.deepEqual(tokenize("I&D 준비"), ["i&d", "준비"]);
  assert.deepEqual(tokenize("I & D"), ["i&d"]);
  assert.deepEqual(tokenize("PFTII&DLCO 검사"), ["pftii", "dlco", "검사"]);
  assert.deepEqual(tokenize("환자&보호자"), ["환자", "보호자"]);
  assert.deepEqual(queryTokens("정형외과 local block 하 I&D").slice(-1), ["i&d"]);
});

test("I&D가 적힌 문단은 단어 검색에서 찾고, 표기만 다른 I & D도 같은 단어로 본다", () => {
  const documents = [
    { id: "a", text: "I & D 시행 전 준비물품: 멸균 세트", metadata: { title: "수술.pdf" } },
    { id: "b", text: "PFTII&DLCO 검사 전 흡입제 중단", metadata: { title: "지침.pdf" } },
    { id: "c", text: "드레싱 교환 주기", metadata: { title: "지침.pdf" } },
  ];
  const ranked = rankByBm25("I&D 준비", documents);
  assert.equal(ranked[0].id, "a");
  assert.ok(!ranked.some((item) => item.id === "b"));
});

test("검색 오류는 '문서에 없음'과 다른 안내를 AI에 준다", () => {
  const source = require("node:fs").readFileSync(
    require.resolve("../../../../utils/agents/aibitat/plugins/memory.js"),
    "utf8"
  );
  assert.match(source, /return SEARCH_ERROR_CONTEXT;/);
  assert.doesNotMatch(source, /An error was raised while searching the vector database/);
  assert.match(source, /등록된 문서에 내용이 없다고 답하지 말고/);
});

test("시간 기록은 단계 이름과 ms만 남긴다", () => {
  let now = 0;
  const lines = [];
  const timer = startTimer("search", { log: (line) => lines.push(line), now: () => now });
  now = 12;
  timer.mark("connect");
  const embedStart = timer.now();
  now = 40;
  timer.since("embed", embedStart);
  const result = timer.done({ results: 3 });
  assert.deepEqual(result, { connect: 12, embed: 28, results: 3, total: 40 });
  assert.deepEqual(lines, ["[SCHAT timing] search connect=12 embed=28 results=3 total=40"]);
  assert.equal(formatTiming("llm", { firstText: 900, total: 2000 }), "[SCHAT timing] llm firstText=900 total=2000");
});

