// 2026-10-17: 보통 질문은 답변 모델(3.5-lite), 환자 상황 판단 질문과 "확인되지 않습니다"만 낸
// 답은 판단 모델(3.8, 생각 low)로 답한다. 가상 근거만 쓴다.
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  isJudgmentQuestion,
  isNotFoundText,
  judgmentRoute,
  notFoundGate,
} = require("../../../../utils/agents/aibitat/utils/answerRoute");
const { completeWithEvidence } = require("../../../../utils/agents/aibitat/utils/evidenceQuotes");

test("환자 상황을 적고 판단을 묻는 질문만 판단 질문으로 본다", () => {
  for (const question of [
    "금일 CCU에서 92병동으로 전입왔어. coccyx G1 sore 욕창보고서 완치로 했어. 금일 간호필요도 욕창은 stage1으로 해야해?",
    "입원 때 욕창 2단계였는데 오늘 1단계로 좋아졌어. 간호필요도 욕창 단계는 언제부터 1로 입력해?",
    "욕창은 없는데 고위험이라 예방 체위변경했어. 간호필요도 욕창관리로 체크해도 돼?",
    "어제 낙상했는데 오늘도 낙상 코드 입력해야 하나요?",
  ])
    assert.equal(isJudgmentQuestion(question), true, question);
  for (const question of [
    "중심정맥관 드레싱 주기 알려줘",
    "PCI 시술 준비",
    "인터벤션에서 하는 시술의 처방",
    "pacemaker 시술 전 준비 어떻게 해?",
    "낙상 고위험 환자 관리 어떻게 해야 해?",
    "",
    null,
  ])
    assert.equal(isJudgmentQuestion(question), false, String(question));
});

test("'확인되지 않습니다'만 있는 답만 못 찾은 답으로 본다", () => {
  assert.equal(isNotFoundText("등록된 문서에서 확인되지 않습니다."), true);
  assert.equal(isNotFoundText(" 등록된 문서에서 확인되지 않습니다 "), true);
  assert.equal(
    isNotFoundText("등록된 문서에서 확인되지 않습니다. 다만 관련 문서의 욕창 단계 입력 기준은 다음과 같습니다."),
    false
  );
  assert.equal(isNotFoundText("욕창 단계는 다음 날부터 입력합니다."), false);
});

test("판단 모델은 Gemini에서만, 답변 모델과 다를 때만, 끌 수 있게 쓴다", () => {
  const gemini = { providerTag: "gemini", model: "gemini-3.5-flash-lite" };
  assert.deepEqual(judgmentRoute(gemini, {}), { model: "gemini-3.8-flash", reasoningEffort: "low" });
  assert.deepEqual(judgmentRoute(gemini, { SCHAT_JUDGMENT_REASONING: "이상한값" }).reasoningEffort, "low");
  assert.equal(judgmentRoute(gemini, { SCHAT_JUDGMENT_ROUTE: "off" }), null);
  assert.equal(judgmentRoute({ ...gemini, model: "gemini-3.8-flash" }, {}), null);
  assert.equal(judgmentRoute({ providerTag: "openai", model: "x" }, {}), null);
});

test("첫머리가 '확인되지 않습니다'와 다르면 바로 내보내고, 같으면 끝까지 잡아 둔다", () => {
  const sent = [];
  const chunk = (content) => ["reportStreamEvent", { type: "textResponseChunk", content }];
  const normal = notFoundGate((type, data) => sent.push(data.content));
  normal.send(...chunk("등록"));
  assert.deepEqual(sent, []);
  normal.send(...chunk("된 서류는"));
  assert.deepEqual(sent, ["등록", "된 서류는"]);
  normal.send(...chunk(" 다음과"));
  assert.deepEqual(sent, ["등록", "된 서류는", " 다음과"]);
  const other = [];
  notFoundGate((type, data) => other.push(data.content)).send(...chunk("욕창은"));
  assert.deepEqual(other, ["욕창은"]);

  sent.length = 0;
  const notFound = notFoundGate((type, data) => sent.push(data.content));
  for (const part of ["등록된 ", "문서에서 ", "확인되지 ", "않습니다."]) notFound.send(...chunk(part));
  assert.deepEqual(sent, []);
  notFound.drop();
  notFound.send(...chunk("늦게 온 글자"));
  assert.deepEqual(sent, ["늦게 온 글자"]);
});

const sources = () => [{ documentName: "가상 매뉴얼.pdf", page: 3, text: "가상 기준: 바뀐 단계는 다음 날부터 입력한다." }];
function fakeProvider(replies) {
  const calls = [];
  return {
    calls,
    providerTag: "gemini",
    model: "gemini-3.5-flash-lite",
    async stream(messages, functions, send) {
      calls.push({ model: this.model, reasoningEffort: this.reasoningEffort, roles: messages.map((m) => m.role) });
      const text = replies[this.model];
      for (const part of text.match(/.{1,3}/gsu))
        send("reportStreamEvent", { type: "textResponseChunk", uuid: this.model, content: part });
      return { textResponse: text, functionCall: null };
    },
  };
}
const ask = (provider, question, sent) =>
  completeWithEvidence({
    provider,
    sources: sources(),
    currentQuestion: question,
    messages: [
      { role: "system", content: "가상 규칙" },
      { role: "user", content: "이전 질문" },
      { role: "assistant", content: "이전 반쪽 답" },
      { role: "user", content: question },
    ],
    functions: [],
    eventHandler: (type, data) => data?.type === "textResponseChunk" && sent.push(data.content),
  });

test("보통 질문은 답변 모델로 한 번만 답하고 늦추지 않는다", async () => {
  const provider = fakeProvider({ "gemini-3.5-flash-lite": "가상 준비물은 A입니다." });
  const sent = [];
  const result = await ask(provider, "가상 시술 준비물 알려줘", sent);
  assert.equal(result.textResponse, "가상 준비물은 A입니다.");
  assert.deepEqual(provider.calls, [
    { model: "gemini-3.5-flash-lite", reasoningEffort: undefined, roles: ["system", "user", "assistant", "user"] },
  ]);
  assert.equal(sent.join(""), "가상 준비물은 A입니다.");
});

test("판단 질문은 처음부터 판단 모델(생각 low)로, 이전 대화 없이 답하고 끝나면 모델을 되돌린다", async () => {
  const provider = fakeProvider({ "gemini-3.8-flash": "금일은 기존 단계, 다음 날부터 바뀐 단계로 입력합니다." });
  const sent = [];
  const result = await ask(provider, "금일 전입왔어. 오늘 바뀐 단계로 입력해야해?", sent);
  assert.deepEqual(provider.calls, [{ model: "gemini-3.8-flash", reasoningEffort: "low", roles: ["system", "user"] }]);
  assert.match(result.textResponse, /다음 날부터/);
  assert.equal(provider.model, "gemini-3.5-flash-lite");
  assert.equal(provider.reasoningEffort, undefined);
  assert.equal(sent.join(""), result.textResponse);
});

test("근거가 있는데 '확인되지 않습니다'만 내면 그 글자는 보내지 않고 판단 모델로 다시 답한다", async () => {
  const provider = fakeProvider({
    "gemini-3.5-flash-lite": "등록된 문서에서 확인되지 않습니다.",
    "gemini-3.8-flash": "바뀐 단계는 다음 날부터 입력합니다.",
  });
  const sent = [];
  const result = await ask(provider, "가상 단계 입력 기준 알려줘", sent);
  assert.deepEqual(provider.calls.map((call) => call.model), ["gemini-3.5-flash-lite", "gemini-3.8-flash"]);
  assert.equal(result.textResponse, "바뀐 단계는 다음 날부터 입력합니다.");
  assert.equal(sent.join(""), result.textResponse);
  assert.equal(provider.model, "gemini-3.5-flash-lite");
});

// 2026-10-24 "PCN change 체크리스트": 다시 답하는 판단 모델이 검색만 거듭하다 빈 답으로 끝남.
test("다시 답할 때는 도구 없이 답하게 하고, 그래도 빈 답·도구 호출이면 처음 답을 보낸다", async () => {
  const provider = fakeProvider({
    "gemini-3.5-flash-lite": "등록된 문서에서 확인되지 않습니다.",
    "gemini-3.8-flash": "",
  });
  const base = provider.stream;
  const tools = [];
  provider.stream = async function (messages, functions, send) {
    tools.push(functions.length);
    if (this.model === "gemini-3.8-flash") {
      provider.calls.push({ model: this.model });
      return { textResponse: "", functionCall: { name: "rag-memory", arguments: {} } };
    }
    return base.call(this, messages, functions, send);
  };
  const sent = [];
  const result = await completeWithEvidence({
    provider,
    sources: sources(),
    currentQuestion: "가상 단계 입력 기준 알려줘",
    messages: [{ role: "system", content: "가상 규칙" }, { role: "user", content: "가상 단계 입력 기준 알려줘" }],
    functions: [{ name: "rag-memory" }],
    eventHandler: (type, data) => data?.type === "textResponseChunk" && sent.push(data.content),
  });
  assert.deepEqual(tools, [1, 0]);
  assert.equal(result.functionCall, null);
  assert.equal(result.textResponse, "등록된 문서에서 확인되지 않습니다.");
  assert.equal(sent.join(""), result.textResponse);
  assert.equal(provider.model, "gemini-3.5-flash-lite");
});

test("판단 모델이 실패해도 원래 모델로 되돌린다", async () => {
  const provider = fakeProvider({});
  provider.stream = async function () {
    throw new Error("가상 오류");
  };
  await assert.rejects(() => ask(provider, "금일 전입왔어. 오늘 입력해야해?", []), /가상 오류/);
  assert.equal(provider.model, "gemini-3.5-flash-lite");
  assert.equal(provider.reasoningEffort, undefined);
});

// 2026-10-17(사용자 승인): 판단 질문의 상황(전실·입원·외박 등)으로 한 번 더 찾기.
const { situationQuery, appendSituationSources } = require("../../../../utils/agents/aibitat/utils/answerRoute");

test("판단 질문에 상황 말이 있을 때만 상황 검색어를 만든다", () => {
  assert.equal(
    situationQuery("통합병동에서 전실 왔는데 가상 모니터링은 전실 오기 전에만 유지했어. 전실 와서 체크해야 해?", {}),
    "통합병동 전실 전동 전입 평가"
  );
  assert.equal(situationQuery("외박 다녀왔는데 오늘 가상 투약 체크해도 돼?", {}), "외박 외출 평가");
  assert.equal(situationQuery("어제 낙상했는데 오늘도 낙상 코드 입력해야 해?", {}), null); // 상황 말 없음
  assert.equal(situationQuery("가상병동 전실 절차 알려줘", {}), null); // 판단 질문 아님
  assert.equal(situationQuery("통합병동에서 전실 왔는데 체크해야 해?", { SCHAT_SITUATION_SEARCH: "off" }), null);
});

test("처음 결과는 그대로 두고 상황 검색의 새 근거만 최대 2개 뒤에 붙인다", () => {
  const first = { sources: [{ id: "a", text: "A" }, { id: "b", text: "B" }], contextTexts: ["A", "B"], other: 1 };
  const extra = { sources: [{ id: "b", text: "B" }, { id: "c", text: "C" }, { id: "d", text: "D" }, { id: "e", text: "E" }] };
  const merged = appendSituationSources(first, extra);
  assert.deepEqual(merged.sources.map((s) => s.id), ["a", "b", "c", "d"]);
  assert.deepEqual(merged.contextTexts, ["A", "B", "C", "D"]);
  assert.equal(merged.other, 1);
  assert.equal(appendSituationSources(first, { sources: [{ id: "a" }] }), first);
});
