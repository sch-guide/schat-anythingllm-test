const test = require("node:test");
const assert = require("node:assert/strict");
const {
  MAX_IMAGE_BYTES,
  attachmentsForChatRecord,
  buildGroundedMultimodalMessages,
  validateSafetyImageAttachments,
} = require("../../../utils/schatSafety/imageAttachment");

function attachment(mime = "image/png", bytes = Buffer.from("safe")) {
  return {
    name: "private-name.png",
    mime,
    contentString: `data:${mime};base64,${bytes.toString("base64")}`,
  };
}

test("이미지 없음은 기존 텍스트 메시지를 유지한다", () => {
  assert.deepEqual(buildGroundedMultimodalMessages("prompt", []), [
    { role: "user", content: "prompt" },
  ]);
});

test("지원 이미지 한 장만 최소 정보로 Gemini 메시지에 넣는다", () => {
  const validated = validateSafetyImageAttachments([attachment("image/webp")]);
  assert.equal(validated.length, 1);
  assert.equal("name" in validated[0], false);
  const messages = buildGroundedMultimodalMessages("prompt", validated);
  assert.equal(messages[0].content[0].type, "text");
  assert.match(messages[0].content[0].text, /SourceUnit/);
  assert.equal(messages[0].content[1].type, "image_url");
});

test("지원하지 않는 형식, 다중 이미지, 5MB 초과를 거부한다", () => {
  assert.throws(
    () => validateSafetyImageAttachments([attachment("image/gif")]),
    { code: "image_type_unsupported" }
  );
  assert.throws(
    () => validateSafetyImageAttachments([attachment(), attachment()]),
    { code: "image_count_exceeded" }
  );
  assert.throws(
    () =>
      validateSafetyImageAttachments([
        attachment("image/png", Buffer.alloc(MAX_IMAGE_BYTES + 1)),
      ]),
    { code: "image_size_exceeded" }
  );
});

test("안전 채팅 기록에는 이미지 원문을 저장하지 않는다", () => {
  const images = [attachment()];
  assert.deepEqual(attachmentsForChatRecord(images, true), []);
  assert.equal(attachmentsForChatRecord(images, false), images);
});
