// 2026-10-24: "Cag체크리스트"(검색 0건), "4Pint 면 20분~30분 안에 끝나도 괜찮지?"(앞 대화 없이 검색),
// "PC 수혈은 얼마동안 줘?"(문서는 '주입 시간')를 고친 검색용 질문 만들기. 원래 질문은 바꾸지 않는다.
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  cleanSearchQuestion,
  looksDependent,
  standaloneSearchQuestion,
} = require("../../../../utils/agents/aibitat/utils/searchQuestion");

test("검색어 정리: 붙은 영어·한글 띄우기, 약어 대문자, 요청 말 빼기, 일상 말 → 문서 말", () => {
  assert.equal(cleanSearchQuestion("Cag체크리스트"), "CAG");
  assert.equal(cleanSearchQuestion("cag 준비물 알려줘"), "CAG");
  assert.equal(cleanSearchQuestion("PCI체크리스트 보여줘"), "PCI");
  assert.equal(cleanSearchQuestion("PC 수혈은 얼마동안 줘?"), "PC 수혈은 주입 시간 ?");
  assert.equal(cleanSearchQuestion("FFP 몇분 동안 줘?"), "FFP 주입 시간 ?");
  assert.match(cleanSearchQuestion("4Pint 면 20분~30분"), /^4 PINT 면 20분~30분$/);
  // 그대로 두는 것: 단위·긴 영어 단어·숫자 뒤 한 글자, 주입과 상관없는 "얼마나 걸려"
  assert.equal(cleanSearchQuestion("IV line 18G 준비"), "IV line 18G 준비");
  assert.equal(cleanSearchQuestion("Foley 교환 주기"), "Foley 교환 주기");
  assert.equal(cleanSearchQuestion("검사 결과 얼마나 걸려?"), "검사 결과 얼마나 걸려?");
  // 요청 말만 있으면 원래 질문
  assert.equal(cleanSearchQuestion("체크리스트"), "체크리스트");
});

const history = [
  { role: "user", content: "PC 수혈은 얼마동안 줘?" },
  { role: "assistant", content: "농축혈소판은 1 unit당 10분 동안 주입합니다." },
  { role: "user", content: "4Pint 면 20분~30분 안에 끝나도 괜찮지?" },
];

test("앞 질문이 있고 이어 말하는 표현이 있을 때만 이어지는 질문으로 본다", () => {
  assert.equal(looksDependent("4Pint 면 20분~30분 안에 끝나도 괜찮지?", history), true);
  assert.equal(looksDependent("4Pint 면 20분~30분 안에 끝나도 괜찮지?", history.slice(2)), false);
  assert.equal(looksDependent("CAG 체크리스트", [...history.slice(0, 2), { role: "user", content: "CAG 체크리스트" }]), false);
});

test("이어지는 질문은 모델로 한 문장을 다시 쓰고, 실패하면 앞 질문과 이어 붙인다", async () => {
  const sent = [];
  const fetchImpl = async (_url, init) => {
    sent.push(JSON.parse(init.body));
    return { json: async () => ({ choices: [{ message: { content: "농축혈소판(PC) 4 Pint를 20분~30분 안에 주입해도 되나요?" } }] }) };
  };
  const env = { GEMINI_API_KEY: "가상", GEMINI_LLM_MODEL_PREF: "gemini-test-model" };
  const result = await standaloneSearchQuestion(history[2].content, history, { env, fetchImpl });
  assert.equal(result.rewritten, "농축혈소판(PC) 4 Pint를 20분~30분 안에 주입해도 되나요?");
  assert.match(result.query, /농축혈소판\(PC\) 4 PINT/);
  assert.match(sent[0].messages[1].content, /앞 질문: PC 수혈은 얼마동안 줘\?/);
  assert.equal(sent[0].model, "gemini-test-model");

  const failing = async () => {
    throw new Error("가상 오류");
  };
  const fallback = await standaloneSearchQuestion(history[2].content, history, { env, fetchImpl: failing });
  assert.equal(fallback.rewritten, "PC 수혈은 얼마동안 줘? 4Pint 면 20분~30분 안에 끝나도 괜찮지?");

  const off = await standaloneSearchQuestion(history[2].content, history, { env: { ...env, SCHAT_FOLLOW_UP_REWRITE: "off" }, fetchImpl });
  assert.equal(off.rewritten, "");
  // 앞 질문이 없으면 다시 쓰지 않는다(호출 없음).
  const before = sent.length;
  const alone = await standaloneSearchQuestion("Cag체크리스트", [{ role: "user", content: "Cag체크리스트" }], { env, fetchImpl });
  assert.deepEqual(alone, { query: "CAG", rewritten: "" });
  assert.equal(sent.length, before);
});
