// 답변 모델 나눠 쓰기 (2026-10-17).
// - 보통 질문은 답변 모델(관리자 화면, 지금 3.5-lite)로 빠르게 답한다.
// - 환자 상황을 적고 판단을 묻는 질문("금일 전입왔어 … stage1으로 해야해?")은 근거 여러 개를
//   합쳐 결론을 내야 해서 판단 모델(기본 3.8, 생각 low)로 처음부터 답한다.
//   예: 욕창 Q9(healing → NPIAP 사정)와 Q10(호전된 다음 날부터)을 합쳐야 하는 질문에서
//   3.5-lite는 Q9만 옮겼다. 3.8이 이전 대화의 반쪽 답을 따라 해서, 판단 질문은 이전 대화 없이
//   보낸다(withoutEarlierTurns). 그러면 생각 low로도 "다음 날부터"를 3번 모두 답한다.
// - 답변 모델이 근거가 있는데도 "등록된 문서에서 확인되지 않습니다."만 내면 그 문장은
//   화면에 내보내지 않고 판단 모델로 한 번 더 답한다.
// - SCHAT_JUDGMENT_ROUTE=off 로 끈다. 모델은 SCHAT_JUDGMENT_MODEL, 생각 정도는
//   SCHAT_JUDGMENT_REASONING(기본 low)으로 바꾼다.
const { modelFor } = require("../../../schatModels");

const NOT_FOUND = "등록된 문서에서 확인되지 않습니다.";
const EFFORTS = new Set(["none", "minimal", "low", "medium", "high"]);
const compact = (value) => String(value || "").replace(/\s/gu, "");

// 판단을 묻는 끝말 + 환자 상황·시점을 적은 말이 함께 있어야 판단 질문으로 본다.
const ASKS_JUDGMENT =
  /(해야\s*(?:해|돼|되|하나|할까|하는|합|함|하지)|해도\s*(?:돼|되|될|괜찮)|하면\s*(?:돼|되|될)|맞(?:아|나|는|습|죠|지)|되나요|될까|돼\s*\?|가능(?:해|한|할)|뭐로|무엇으로|어느\s*(?:것|걸|쪽)으로|언제부터|몇\s*(?:점|단계)으로)/u;
const DESCRIBES_SITUATION =
  /(금일|오늘|당일|어제|내일|모레|익일|언제부터|다음\s*날|전입|전동|전출|입원\s*(?:시|때|당일|중)|퇴원|했어|했는데|했고|했음|왔어|왔는데|됐어|됐는데|되었|있었|이었|였는데|인데|환자가|환자는)/u;

function isJudgmentQuestion(question) {
  if (typeof question !== "string") return false;
  const text = question.slice(0, 2000);
  return ASKS_JUDGMENT.test(text) && DESCRIBES_SITUATION.test(text);
}

function isNotFoundText(text) {
  const value = compact(text);
  const target = compact(NOT_FOUND);
  return value.startsWith(target.slice(0, -1)) && value.length <= target.length + 15;
}

/** 판단 모델 설정. 끄거나, Gemini가 아니거나, 답변 모델과 같으면 null. */
function judgmentRoute(provider, env = process.env) {
  if (String(env.SCHAT_JUDGMENT_ROUTE || "on").toLowerCase() === "off") return null;
  if (provider?.providerTag !== "gemini") return null;
  const model = modelFor("judgment", env);
  if (!model || model === provider.model) return null;
  const effort = String(env.SCHAT_JUDGMENT_REASONING || "low").toLowerCase();
  return { model, reasoningEffort: EFFORTS.has(effort) ? effort : "low" };
}

/**
 * 판단 질문은 질문 안에 상황이 다 적혀 있으므로 같은 대화방의 이전 질문·답을 보내지 않는다.
 * 이전 답(특히 같은 질문에 대한 예전 반쪽 답)을 따라 하는 일이 있었다(2026-10-17 측정:
 * 이전 20턴 포함 시 "다음 날부터" 1~2/3, 빼면 3/3). 시스템 지시와 마지막 질문(+그 뒤 검색 결과)만 남긴다.
 */
function withoutEarlierTurns(messages = []) {
  const lastUser = messages.findLastIndex((message) => message?.role === "user");
  if (lastUser < 0) return messages;
  return [
    ...messages.slice(0, lastUser).filter((message) => message?.role === "system"),
    ...messages.slice(lastUser),
  ];
}

// ---- 판단 질문의 상황 검색 (2026-10-17, 사용자 승인) ---------------------------------
// "통합병동에서 전실 왔는데 … 심전도 모니터링 체크해야 해?"처럼 두 가지(항목 기준 + 병동을
// 옮긴 날의 평가 기준)를 함께 묻는 질문은 근거 4개가 모두 '심전도' 쪽으로 가서
// 매뉴얼 7쪽(전입 시 이전 병동 재원 시간부터 평가)·107쪽(전입 병동에서 함께 신고)을 못 찾았다.
// 판단 질문에 상황 말이 있으면 상황으로 한 번 더 찾아, 처음 결과 뒤에 새 근거를 최대 2개 더한다.
// 처음 검색 결과·점수·순서는 바꾸지 않는다. SCHAT_SITUATION_SEARCH=off로 끈다.
const SITUATIONS = [
  [/전실|전동|전입|전출|옮겨\s*왔|옮겨\s*온/u, "전실 전동 전입"],
  [/입원|퇴원/u, "입원 퇴원"],
  [/외박|외출/u, "외박 외출"],
];
const PLACE = /[가-힣A-Za-z0-9]*병동|ICU|CCU|중환자실/giu;
const SITUATION_EXTRA = 2;

/** 상황 검색어(예: "통합병동 전실 전동 전입 평가"). 판단 질문이 아니거나 상황 말이 없으면 null. */
function situationQuery(question, env = process.env) {
  if (String(env.SCHAT_SITUATION_SEARCH || "on").toLowerCase() === "off") return null;
  if (!isJudgmentQuestion(question)) return null;
  const text = String(question).slice(0, 2000);
  const words = SITUATIONS.filter(([pattern]) => pattern.test(text)).map(([, word]) => word);
  if (!words.length) return null;
  const places = [...new Set((text.match(PLACE) || []).map((place) => place.replace(/에서$|으로$|로$/u, "")))].slice(0, 2);
  return [...places, ...words, "평가"].join(" ");
}

/** 처음 결과는 그대로 두고, 상황 검색에서 새로 나온 근거만 뒤에 최대 2개 붙인다. */
function appendSituationSources(result = {}, extra = {}, keyOf = (source) => source?.id) {
  const sources = result.sources || [];
  const seen = new Set(sources.map(keyOf));
  const added = (extra.sources || [])
    .filter((source) => {
      const key = keyOf(source);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, SITUATION_EXTRA);
  if (!added.length) return result;
  return {
    ...result,
    sources: [...sources, ...added],
    contextTexts: [...(result.contextTexts || []), ...added.map((source) => source.text).filter(Boolean)],
  };
}

/** 한 번의 호출 동안만 모델을 바꾸고, 끝나면(실패해도) 원래대로 돌린다. */
async function withModel(provider, { model, reasoningEffort }, run) {
  const before = { model: provider.model, reasoningEffort: provider.reasoningEffort };
  provider.model = model;
  provider.reasoningEffort = reasoningEffort;
  try {
    return await run();
  } finally {
    provider.model = before.model;
    provider.reasoningEffort = before.reasoningEffort;
  }
}

/**
 * 답 첫머리가 "등록된 문서에서 확인되지 않습니다."일 수 있는 동안만 화면 전송을 잡아 둔다.
 * 다른 글자가 나오면 바로 내보내므로 보통 답변은 늦어지지 않는다.
 */
function notFoundGate(send) {
  if (!send) return null;
  const target = compact(NOT_FOUND);
  let holding = true;
  let seen = "";
  let held = [];
  const release = () => {
    if (!holding) return;
    holding = false;
    const events = held;
    held = [];
    for (const [type, data] of events) send(type, data);
  };
  return {
    send(type, data) {
      if (!holding) return send(type, data);
      held.push([type, data]);
      if (type !== "reportStreamEvent" || data?.type !== "textResponseChunk") return;
      seen += compact(data.content);
      if (!target.startsWith(seen) && !seen.startsWith(target)) release();
    },
    release,
    drop() {
      holding = false;
      held = [];
    },
  };
}

module.exports = {
  NOT_FOUND,
  isJudgmentQuestion,
  isNotFoundText,
  judgmentRoute,
  withModel,
  withoutEarlierTurns,
  situationQuery,
  appendSituationSources,
  notFoundGate,
};
