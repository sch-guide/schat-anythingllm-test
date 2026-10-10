import test from "node:test";
import assert from "node:assert/strict";
import {
  AUTO_STOP_SECONDS,
  SLOW_NOTICE_SECONDS,
  STOPPED_TEXT,
  WAITING_PHASE_LABELS,
  waitingPhase,
  waitingPhaseLabel,
} from "./schatWaitingStatus.js";

const user = (content = "세프트리악손 AST 해야 해?") => ({
  role: "user",
  content,
});
const status = (content) => ({
  role: "assistant",
  type: "statusResponse",
  content,
});
const tool = () => ({
  role: "assistant",
  type: "toolCallInvocation",
  content: "Assistant called rag-memory",
});
const FOUND =
  "Found 4 additional piece of context to help answer this question.";

test("right after the question: 문서를 찾는 중…", () => {
  assert.equal(waitingPhase([user()]), "search");
  assert.equal(waitingPhaseLabel([user()]), "문서를 찾는 중…");
});

test("after the first hospital search: 답변을 작성하는 중…", () => {
  assert.equal(waitingPhase([user(), status(`undefined: ${FOUND}`)]), "answer");
});

test("an extra search the AI asked for: 문서를 한 번 더 찾는 중… until it returns", () => {
  const history = [
    user(),
    status(`undefined: ${FOUND}`),
    tool(),
    status("@agent is executing `rag-memory` tool {}"),
  ];
  assert.equal(waitingPhase(history), "research");
  assert.equal(
    waitingPhase([...history, status(`@agent: ${FOUND}`)]),
    "answer"
  );
  assert.equal(
    waitingPhase([
      ...history,
      status(`@agent: ${FOUND}`),
      tool(),
      status("@agent is executing `rag-memory` tool {}"),
    ]),
    "research"
  );
});

test("a search that found nothing still counts as finished", () => {
  assert.equal(
    waitingPhase([
      user(),
      status(
        "@agent: I didn't find anything locally that would help answer this question."
      ),
    ]),
    "answer"
  );
});

test("only the latest question counts", () => {
  const earlier = [
    user("이전 질문"),
    status(`undefined: ${FOUND}`),
    tool(),
    status(`@agent: ${FOUND}`),
    { role: "assistant", content: "이전 답" },
  ];
  assert.equal(waitingPhase([...earlier, user()]), "search");
});

test("the agreed times and texts", () => {
  assert.equal(SLOW_NOTICE_SECONDS, 20);
  assert.equal(AUTO_STOP_SECONDS, 90);
  assert.deepEqual(Object.values(WAITING_PHASE_LABELS), [
    "문서를 찾는 중…",
    "문서를 한 번 더 찾는 중…",
    "답변을 작성하는 중…",
  ]);
  assert.equal(
    STOPPED_TEXT.timeout,
    "응답이 늦어지고 있습니다. 잠시 후 다시 시도해 주세요."
  );
  for (const text of Object.values(STOPPED_TEXT))
    assert.doesNotMatch(text, /확인되지 않습니다/);
});
