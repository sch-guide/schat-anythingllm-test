const { createHash } = require("node:crypto");
const { startTimer } = require("../../../schatTiming");
const OPEN = "<schat_evidence>";
const CLOSE = "</schat_evidence>";
const compact = (value) => String(value || "").replace(/\s/gu, "");
function evidenceSourceId(source = {}) {
  return createHash("sha256")
    .update(
      JSON.stringify([
        source.pdfRef || source.spreadsheetRef || source.document_id || source.documentId || "",
        source.documentName || source.document_name || source.title || "",
        source.page ?? null,
        source.text || source.excerpt || "",
      ])
    )
    .digest("hex")
    .slice(0, 24);
}
function recordQuotes(sources, body) {
  const byId = new Map();
  for (const source of sources) {
    source.evidenceQuotes = [];
    const id = evidenceSourceId(source);
    if (!byId.has(id)) byId.set(id, []);
    byId.get(id).push(source);
  }
  let data;
  try {
    data = JSON.parse(body);
  } catch {
    return;
  }
  if (!Array.isArray(data?.quotes) || data.quotes.length > 32) return;
  for (const quote of data.quotes) {
    const linkedSources = byId.get(quote?.source_id);
    const source = linkedSources?.[0];
    if (!source || typeof quote.text !== "string" || quote.text.length > 4000)
      continue;
    const needle = compact(quote.text);
    const original = compact(source.text || source.excerpt);
    const start = original.indexOf(needle);
    if (
      needle.length < 8 ||
      start < 0 ||
      original.indexOf(needle, start + 1) >= 0
    )
      continue;
    for (const linked of linkedSources) {
      if (!linked.evidenceQuotes.includes(quote.text)) linked.evidenceQuotes.push(quote.text);
    }
  }
}
// 근거 꼬리표: 근거마다 붙인 "[evidence_source_id=…]"를 모델이 답 문장 뒤에 "[e26dc…]"처럼
// 베껴 쓰는 일이 있다(2026-10-24). 직원 화면과 저장되는 답에서는 지운다.
const SOURCE_ID_MARK =
  /[ \t]?\[(?:evidence_source_id\s*=\s*|source_id\s*[:=]\s*)?[0-9a-f]{24}(?:\s*[,;]\s*(?:evidence_source_id\s*=\s*)?[0-9a-f]{24})*\]/gu;
function stripSourceIds(text = "") {
  return String(text).replace(SOURCE_ID_MARK, "");
}
// 아직 닫히지 않은 꼬리표 조각(" [e26dc")과 끝의 빈칸은 다음 조각이 올 때까지 잡아 둔다.
// 빈칸도 잡아야 꼬리표 앞 빈칸이 먼저 나가 "10분 ."처럼 남지 않는다.
function heldIdTail(text = "") {
  const spaces = text.length - text.replace(/[ \t]+$/u, "").length;
  const start = text.lastIndexOf("[");
  if (start < 0 || text.length - start > 80 || !/^\[[0-9a-z_=:;,\s]*$/u.test(text.slice(start)))
    return spaces;
  let from = start;
  while (from > 0 && /[ \t]/u.test(text[from - 1])) from -= 1;
  return text.length - from;
}
// Hold only a possible opening-tag suffix. No evidence metadata reaches the UI,
// even when the provider splits the tag across individual character chunks.
function evidenceStream(send) {
  let pending = "",
    hidden = false,
    last = null;
  const emit = (content) => {
    if (content && last) send(last.type, { ...last.data, content });
  };
  return {
    forward(type, data) {
      if (type !== "reportStreamEvent" || data?.type !== "textResponseChunk") {
        if (
          type === "reportStreamEvent" &&
          data?.type === "fullTextResponse" &&
          typeof data.content === "string"
        ) {
          send(type, {
            ...data,
            content: stripSourceIds(data.content.split(OPEN)[0]).trimEnd(),
          });
        } else send(type, data);
        return;
      }
      last = { type, data };
      if (hidden) return;
      pending = stripSourceIds(pending + (data.content || ""));
      const position = pending.indexOf(OPEN);
      if (position >= 0) {
        emit(pending.slice(0, position));
        pending = "";
        hidden = true;
        return;
      }
      let held = heldIdTail(pending);
      for (let n = 1; n < OPEN.length && n <= pending.length; n++)
        if (pending.endsWith(OPEN.slice(0, n))) held = Math.max(held, n);
      emit(pending.slice(0, pending.length - held));
      pending = pending.slice(pending.length - held);
    },
    finish() {
      if (!hidden && !OPEN.startsWith(pending)) emit(stripSourceIds(pending));
      pending = "";
    },
  };
}
async function completeWithEvidence({
  provider,
  sources = [],
  messages = [],
  functions = [],
  eventHandler,
  workspace,
  currentQuestion,
}) {
  if(workspace&&typeof currentQuestion==='string'){
    const answer=await require('./sheetDepartmentContacts').resolveWorkspaceDepartmentContact(workspace,currentQuestion);
    if(answer){
      sources.splice(0,sources.length,answer.source);
      const uuid=require('node:crypto').randomUUID();
      eventHandler?.('reportStreamEvent',{type:'textResponseChunk',uuid,content:answer.text});
      return {uuid,textResponse:answer.text,functionCall:null};
    }
  }
  // Gemini 첫 글자·완료 시간만 기록한다(내용은 남기지 않음).
  const timer = startTimer("llm");
  let firstText = false;
  const timedHandler = eventHandler
    ? (type, data) => {
        if (
          !firstText &&
          data?.type === "textResponseChunk" &&
          String(data.content || "").trim()
        ) {
          firstText = true;
          timer.set("firstText", timer.elapsed());
        }
        return eventHandler(type, data);
      }
    : null;
  const finishTiming = (completion) => {
    timer.done({
      sources: sources.length,
      toolCall: completion?.functionCall ? 1 : 0,
    });
    return completion;
  };
  if (!sources.length)
    return (
      timedHandler
        ? provider.stream(messages, functions, timedHandler)
        : provider.complete(messages, functions)
    ).then(finishTiming);
  const { directoryAnswer } = require("./directoryEvidence");
  const question = messages.findLast(message => message.role === "user")?.content;
  const directory = typeof question === "string" ? directoryAnswer(sources, question) : null;
  if (directory) {
    for (const source of sources) source.evidenceQuotes = [];
    directory.source.evidenceQuotes = directory.quotes || [directory.quote];
    const uuid = require("node:crypto").randomUUID();
    eventHandler?.("reportStreamEvent", {
      type: "textResponseChunk", uuid, content: directory.text,
    });
    return {uuid, textResponse:directory.text, functionCall:null};
  }
  const instruction =
    `\nFor the final answer only, append ${OPEN}{"quotes":[{"source_id":"ID","text":"exact original passage used in your answer"}]}${CLOSE}. Copy only the specific supporting sentences or table cells verbatim from the matching source, never a whole page or unrelated headers. Include each supporting passage even when paraphrasing the visible answer. Do not invent quotes. Never write source IDs or bracketed IDs in the visible answer; they belong only inside the evidence block. No evidence block on tool calls. Source IDs (same order as retrieved sources): ` +
    sources
      .map(
        (source, index) =>
          `${index + 1}: ${evidenceSourceId(source)} (${source.documentName || source.document_name || "document"}, page ${source.page ?? "?"})`
      )
      .join("; ");
  const sentMessages = messages.map((message) => ({ ...message }));
  const system = sentMessages.find(
    (message) =>
      message.role === "system" && typeof message.content === "string"
  );
  if (system) system.content += instruction;
  else sentMessages.unshift({ role: "system", content: instruction });
  if (sources.some(source => /전화번호부/u.test(source.documentName || source.title || ""))) {
    sentMessages.find(message=>message.role==="system").content +=
      "\n전화번호부 표의 번호 종류(단축·내선·직통)는 숫자의 길이나 나열 순서로 추측하지 마세요. " +
      "머리글과 해당 사람의 행 연결이 확인되지 않으면 번호 종류를 확인할 수 없다고 안내하세요. " +
      "옆 사람이나 다른 부서의 번호를 섞지 마세요.";
  }
  const generate = async (handler, sendMessages = sentMessages, tools = functions) => {
    const stream = handler ? evidenceStream(handler) : null;
    try {
      return stream
        ? await provider.stream(sendMessages, tools, stream.forward)
        : await provider.complete(sendMessages, tools);
    } finally {
      stream?.finish();
    }
  };
  // 판단 질문은 판단 모델로, 근거가 있는데 "확인되지 않습니다"면 판단 모델로 한 번 더 (answerRoute.js).
  const route = require("./answerRoute");
  const judgment = route.judgmentRoute(provider);
  let routeCode = 0; // 시간 기록: 0 답변 모델, 1 판단 질문, 2 다시 답함, 3 다시 답하기 실패(처음 답)
  let completion;
  if (judgment && route.isJudgmentQuestion(currentQuestion ?? question)) {
    routeCode = 1;
    completion = await route.withModel(provider, judgment, () =>
      generate(timedHandler, route.withoutEarlierTurns(sentMessages))
    );
  } else if (judgment) {
    const gate = route.notFoundGate(timedHandler);
    completion = await generate(gate ? gate.send : null);
    const text = typeof completion?.textResponse === "string" ? completion.textResponse.split(OPEN)[0] : "";
    if (!completion?.functionCall && route.isNotFoundText(text)) {
      // 다시 답할 때는 도구 없이 이미 찾은 근거로만 답하게 한다. 도구를 주면 판단 모델이
      // 검색을 거듭하다 빈 답으로 끝난 일이 있었다("PCN change 체크리스트", 2026-10-24).
      // 다시 답하기가 실패하거나 빈 답이면 처음 답("확인되지 않습니다")을 그대로 보낸다.
      routeCode = 2;
      const first = completion;
      const retry = await route
        .withModel(provider, judgment, () => generate(timedHandler, sentMessages, []))
        .catch(() => null);
      const retryText =
        typeof retry?.textResponse === "string"
          ? stripSourceIds(retry.textResponse.split(OPEN)[0]).trim()
          : "";
      if (retry && !retry.functionCall && retryText) {
        gate?.drop();
        completion = retry;
      } else {
        gate?.release();
        completion = first;
        routeCode = 3;
      }
    } else gate?.release();
  } else completion = await generate(timedHandler);
  timer.set("route", routeCode);
  finishTiming(completion);
  if (
    !completion ||
    completion.functionCall ||
    typeof completion.textResponse !== "string"
  )
    return completion;
  const position = completion.textResponse.indexOf(OPEN);
  const closePosition = position < 0 ? -1 : completion.textResponse.indexOf(CLOSE, position + OPEN.length);
  const raw = closePosition < 0 ? "" : completion.textResponse.slice(position + OPEN.length, closePosition);
  recordQuotes(sources, raw);
  if (position >= 0)
    completion.textResponse = completion.textResponse
      .slice(0, position)
      .trimEnd();
  completion.textResponse = stripSourceIds(completion.textResponse);
  return completion;
}
module.exports = { evidenceSourceId, completeWithEvidence, stripSourceIds };
