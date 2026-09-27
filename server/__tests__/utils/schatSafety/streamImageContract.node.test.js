const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const streamPath = path.resolve(
  __dirname,
  "../../../utils/chats/stream.js"
);
const source = fs.readFileSync(streamPath, "utf8");

test("직원 이미지가 structured 답변 호출에는 전달되고 채팅 기록에는 저장되지 않는다", () => {
  const structuredCall = source.match(
    /runSchatCompletion\(\{(?<body>[\s\S]*?)\n\s*\}\);/
  );
  assert.ok(structuredCall?.groups?.body);
  assert.match(structuredCall.groups.body, /\n\s*attachments,/);
  assert.match(structuredCall.groups.body, /\n\s*safetyGateEnabled,/);
  assert.doesNotMatch(structuredCall.groups.body, /attachmentsForChatRecord/);

  assert.match(
    source,
    /const persistedAttachments = attachmentsForChatRecord\([\s\S]*?attachments: persistedAttachments/
  );
});

test("직원 structured 답변과 Python safety gate는 별도 환경값으로 제어된다", () => {
  assert.match(source, /SCHAT_SAFETY_ENABLED/);
  assert.match(source, /SCHAT_SAFETY_GATE_ENABLED/);
});

test("직원 이미지 검증은 모델 연결과 문서 검색보다 먼저 실행된다", () => {
  const validation = source.indexOf("validateSafetyImageAttachments(attachments)");
  const provider = source.indexOf("resolveLLMConnector({");
  const retrieval = source.indexOf("performSimilaritySearch({");
  assert.ok(validation >= 0);
  assert.ok(provider > validation);
  assert.ok(retrieval > validation);
});

test("직원 이미지 질문은 명령·에이전트 우회 없이 안전 채팅 경로만 사용한다", () => {
  assert.match(
    source,
    /if \(!hasSafetyImage && Object\.keys\(VALID_COMMANDS\)\.includes\(updatedMessage\)\)/
  );
  assert.match(source, /const isAgentChat = hasSafetyImage\s*\? false/);
});

test("검색 근거가 없으면 일반지식 대신 관련 근거 부족 안내로 중단한다", () => {
  assert.match(
    source,
    /등록된 병원 지침에서 관련 근거를 확인할 수 없습니다\./
  );
  assert.match(
    source,
    /if \(\(chatMode === "query" \|\| safetyEnabled\) && contextTexts\.length === 0\)/
  );
});
