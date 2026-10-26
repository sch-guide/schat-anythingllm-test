// 검색용 질문 만들기 (2026-10-24).
// 화면에 보이는 원래 질문은 그대로 두고, 문서 검색에만 쓰는 질문을 다듬는다.
//
// 1) 정리: "Cag체크리스트" → "CAG". 영어·한글이 붙은 곳을 띄우고, 짧은 영어 약어를
//    대문자로 맞추고, "체크리스트·준비물·알려줘" 같은 요청 말을 뺀다.
//    (붙여 쓴 "Cag체크리스트"는 검색 결과 0건, "CAG 체크리스트"는 CAG 쪽을 찾았다.)
// 2) 이어지는 질문: "PC 수혈은 얼마동안 줘?" 다음 "4Pint 면 20분~30분 안에 끝나도 괜찮지?"처럼
//    앞 대화에 기대는 질문은 앞 대화를 넣어 혼자 읽어도 뜻이 통하는 검색 질문으로 바꾼다.
//    답변 모델로 한 문장만 다시 쓰고(최대 2.5초), 실패하면 앞 질문과 이어 붙인다.
//    SCHAT_FOLLOW_UP_REWRITE=off 로 끈다.

// 체크리스트 기능을 켜는 신호일 뿐 문서 내용 말은 아님(체크리스트 버튼은 원래 질문으로 정함).
// "챙기는 물품", "필요한 물품"은 "준비물"과 같은 요청 말(2026-10-26 "kalimate enema 챙기는 물품").
const REQUEST_WORDS =
  /체크\s*리스트|준비물|챙기(?:는|길|어야\s*할|어야\s*하는)?\s*(?:물품|물건|것|거)|필요한\s*(?:물품|물건)|가져갈\s*(?:물품|물건|것|거)|알려\s*줘요?|알려\s*주세요|알려\s*줄래|보여\s*줘요?|보여\s*주세요|좀(?=\s|$)/gu;
const UNITS = new Set(["mcg", "min", "sec", "day", "hrs", "amp", "tab", "cap", "bag", "set"]);
const DEPENDENT =
  /(?:그럼|그러면|그거|이거|저거|그건|그것|그때|그중|아까|방금|위에서|위의|그\s*다음|그\s*후|괜찮|되나|돼\?|될까|해도|면\s|이면|라면|다면|으면)/u;

// 일상 말 → 문서 말(검색어에만). "PC 수혈은 얼마동안 줘?"는 문서의 "주입 시간"과 이어지지 않아
// 주입 시간 표(1 Unit당 10분)를 못 찾았다.
const EVERYDAY_TO_DOCUMENT = [
  [/얼마\s*동안\s*(?:줘|주나|주면|줘요|주세요|들어가|맞|넣)[가-힣]*/gu, " 주입 시간 "],
  [/몇\s*분\s*(?:동안|만에|에)\s*(?:줘|주|들어가|넣)[가-힣]*/gu, " 주입 시간 "],
  [/얼마나\s*빨리\s*(?:줘|주|들어가|넣)[가-힣]*/gu, " 주입 시간 "],
  [/(?:주입|투여|넣는\s*데|들어가는\s*데)\s*얼마나\s*걸려[가-힣]*/gu, " 주입 시간 "],
  // "수혈시간", "pc 수혈시간" → 문서는 "주입 시간"(2026-10-24 운영 실패 질문)
  [/수혈\s*시간/gu, " 수혈 주입 시간 "],
];

// 붙여 쓴 한글 낱말 띄우기(검색어에만). "취약환자관리", "배뇨배설", "혈액주입시간"은
// 검색 0건, "취약환자 관리", "배뇨 배설", "혈액 주입 시간"은 문서를 찾았다(2026-10-24).
// 앞에 한글이 두 글자 이상 붙어 있을 때만 이 낱말 앞을 띄운다.
const ATTACHED_WORDS = /(?<=[가-힣]{2})(관리|간호|시간|방법|절차|기록|교체|교환|제거|삽입|배설|사정|주입)/gu;

/** 검색어 정리. 정리 뒤 아무것도 안 남으면 원래 질문. */
function cleanSearchQuestion(question = "") {
  const original = String(question || "").normalize("NFKC");
  const cleaned = EVERYDAY_TO_DOCUMENT.reduce(
    (value, [pattern, replacement]) => value.replace(pattern, replacement),
    original
  )
    .replace(ATTACHED_WORDS, " $1")
    .replace(/([A-Za-z])(?=[가-힣])/gu, "$1 ")
    .replace(/([가-힣])(?=[A-Za-z])/gu, "$1 ")
    // "4Pint" → "4 Pint"(동의어가 맞도록). "18G"처럼 숫자 뒤 한 글자는 그대로.
    .replace(/([0-9])(?=[A-Za-z]{2,})/gu, "$1 ")
    // 약어 대문자: 대문자가 섞인 2~4글자(Cag, Pint)와 소문자 3글자(cag). 단위(mg, ml 등)는 그대로.
    .replace(/\b[A-Za-z]{2,4}\b/gu, (word) =>
      /[A-Z]/u.test(word) || (word.length === 3 && !UNITS.has(word))
        ? word.toUpperCase()
        : word
    )
    .replace(REQUEST_WORDS, " ")
    .replace(/\s+/gu, " ")
    .trim();
  return cleaned || original.trim();
}

function lastUserBefore(chatHistory = []) {
  let skippedCurrent = false;
  for (let index = chatHistory.length - 1; index >= 0; index -= 1) {
    const message = chatHistory[index];
    if (message?.role !== "user") continue;
    if (!skippedCurrent) {
      skippedCurrent = true;
      continue;
    }
    const text = String(message.content || "").split("<hospital_document_context>")[0].trim();
    if (text) return { index, text };
  }
  return null;
}

/** 앞 대화에 기대는 질문인지(앞 질문이 있고, 이어 말하는 표현이 있을 때). */
function looksDependent(question = "", chatHistory = []) {
  if (!lastUserBefore(chatHistory)) return false;
  return DEPENDENT.test(String(question || ""));
}

function lastAssistantAfter(chatHistory = [], index = -1) {
  for (let i = chatHistory.length - 1; i > index; i -= 1)
    if (chatHistory[i]?.role === "assistant" && typeof chatHistory[i].content === "string")
      return chatHistory[i].content.slice(0, 400);
  return "";
}

const REWRITE_PROMPT = [
  "간호사가 병원 지침 챗봇에 이어서 물은 질문을, 앞 대화를 몰라도 뜻이 통하는 문서 검색용 질문 한 문장으로 바꾸세요.",
  "앞 대화의 주제(약품·검사·시술·혈액제제 이름 등)를 넣고, 현재 질문의 숫자·조건은 그대로 두세요.",
  "답이나 새 사실은 넣지 마세요. 이미 혼자 뜻이 통하면 그대로 쓰세요. 질문 한 문장만 출력하세요.",
].join(" ");

async function rewriteWithModel({ question, previous, previousAnswer, env, fetchImpl }) {
  const { modelFor } = require("../../../schatModels");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Number(env.SCHAT_FOLLOW_UP_REWRITE_TIMEOUT_MS) || 2500);
  try {
    const response = await fetchImpl(
      "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
      {
        method: "POST",
        signal: controller.signal,
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${env.GEMINI_API_KEY}`,
        },
        body: JSON.stringify({
          model: modelFor("answer", env),
          temperature: 0,
          messages: [
            { role: "system", content: REWRITE_PROMPT },
            {
              role: "user",
              content: `앞 질문: ${previous}\n앞 답변(일부): ${previousAnswer || "(없음)"}\n현재 질문: ${question}`,
            },
          ],
        }),
      }
    );
    const data = await response.json();
    const text = String(data?.choices?.[0]?.message?.content || "")
      .replace(/^["'“”]+|["'“”]+$/gu, "")
      .split("\n")[0]
      .trim();
    return text && text.length <= 300 ? text : "";
  } finally {
    clearTimeout(timer);
  }
}

// 시스템 상태의 "Gemini 하루 호출 수"에도 다시 쓰기 호출이 세어지도록 같은 집계를 거친다.
function defaultFetch() {
  try {
    const { countingFetch, dailyUsage } = require("../../../geminiDailyUsage");
    return countingFetch(globalThis.fetch, dailyUsage);
  } catch {
    return globalThis.fetch;
  }
}

/**
 * 검색에 쓸 질문. { query, rewritten } — rewritten은 앞 대화를 반영해 바꿨을 때의 문장("").
 * 원래 질문·화면 표시는 바꾸지 않는다.
 */
async function standaloneSearchQuestion(
  question = "",
  chatHistory = [],
  { env = process.env, fetchImpl = defaultFetch() } = {}
) {
  const original = String(question || "").trim();
  let rewritten = "";
  if (
    String(env.SCHAT_FOLLOW_UP_REWRITE || "on").toLowerCase() !== "off" &&
    looksDependent(original, chatHistory)
  ) {
    const previous = lastUserBefore(chatHistory);
    try {
      if (env.GEMINI_API_KEY && fetchImpl)
        rewritten = await rewriteWithModel({
          question: original,
          previous: previous.text.slice(0, 300),
          previousAnswer: lastAssistantAfter(chatHistory, previous.index),
          env,
          fetchImpl,
        });
    } catch {
      rewritten = "";
    }
    // 다시 쓰기에 실패하면 앞 질문과 이어 붙여 찾는다.
    if (!rewritten) rewritten = `${previous.text.slice(0, 200)} ${original}`;
    if (rewritten === original) rewritten = "";
  }
  return { query: cleanSearchQuestion(rewritten || original), rewritten };
}

module.exports = {
  cleanSearchQuestion,
  looksDependent,
  standaloneSearchQuestion,
};
