// What the employee sees while SCHAT prepares an answer.
//
// The agent run reports its steps in the chat history of the current turn:
//   - the hospital search done before the AI starts ("Found N additional
//     piece of context ...", or "didn't find anything ..."),
//   - each extra search the AI asks for (a toolCallInvocation and an
//     "@agent is executing `rag-memory` tool" status),
//   - and the search result of that extra search (another "Found ...").
// These messages stay hidden; only the friendly step below is shown.

export const SLOW_NOTICE_SECONDS = 20;
export const AUTO_STOP_SECONDS = 90;

export const WAITING_PHASE_LABELS = {
  search: "문서를 찾는 중…",
  research: "문서를 한 번 더 찾는 중…",
  answer: "답변을 작성하는 중…",
};

export const SLOW_NOTICE_TEXT =
  "답변이 오래 걸리고 있습니다. 조금만 더 기다려 주세요.";

const SEARCH_FINISHED =
  /Found \d+ additional piece|didn't find anything|did not find anything/i;
const EXTRA_SEARCH_STARTED = /executing `rag-memory`/i;

function latestUserIndex(history = []) {
  for (let index = history.length - 1; index >= 0; index -= 1)
    if (history[index]?.role === "user") return index;
  return -1;
}

export function waitingPhase(history = []) {
  let finished = 0;
  let toolCalls = 0;
  let executing = 0;
  for (const message of history.slice(latestUserIndex(history) + 1)) {
    const content = typeof message?.content === "string" ? message.content : "";
    if (message?.type === "toolCallInvocation") toolCalls += 1;
    if (message?.type !== "statusResponse") continue;
    if (message.phase === "answer") finished += 1;
    if (SEARCH_FINISHED.test(content)) finished += 1;
    else if (EXTRA_SEARCH_STARTED.test(content)) executing += 1;
  }
  // One extra search shows up both as a tool call and as a status line.
  const extraSearches = Math.max(toolCalls, executing);
  if (finished === 0 && extraSearches === 0) return "search";
  // The first finished search is the one done before the AI starts.
  if (extraSearches >= finished) return "research";
  return "answer";
}

export function waitingPhaseLabel(history = []) {
  return WAITING_PHASE_LABELS[waitingPhase(history)];
}

export const STOPPED_TEXT = {
  user: "답변을 멈췄습니다.",
  timeout: "응답이 늦어지고 있습니다. 잠시 후 다시 시도해 주세요.",
};
