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
            content: data.content.split(OPEN)[0].trimEnd(),
          });
        } else send(type, data);
        return;
      }
      last = { type, data };
      if (hidden) return;
      pending += data.content || "";
      const position = pending.indexOf(OPEN);
      if (position >= 0) {
        emit(pending.slice(0, position));
        pending = "";
        hidden = true;
        return;
      }
      let held = 0;
      for (let n = 1; n < OPEN.length && n <= pending.length; n++)
        if (pending.endsWith(OPEN.slice(0, n))) held = n;
      emit(pending.slice(0, pending.length - held));
      pending = pending.slice(pending.length - held);
    },
    finish() {
      if (!hidden && !OPEN.startsWith(pending)) emit(pending);
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
    `\nFor the final answer only, append ${OPEN}{"quotes":[{"source_id":"ID","text":"exact original passage used in your answer"}]}${CLOSE}. Copy only the specific supporting sentences or table cells verbatim from the matching source, never a whole page or unrelated headers. Include each supporting passage even when paraphrasing the visible answer. Do not invent quotes. No evidence block on tool calls. Source IDs (same order as retrieved sources): ` +
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
  const stream = timedHandler ? evidenceStream(timedHandler) : null;
  let completion;
  try {
    completion = stream
      ? await provider.stream(sentMessages, functions, stream.forward)
      : await provider.complete(sentMessages, functions);
  } finally {
    stream?.finish();
  }
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
  return completion;
}
module.exports = { evidenceSourceId, completeWithEvidence };
