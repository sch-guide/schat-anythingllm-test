const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const ALLOWED_IMAGE_MIME_TYPES = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
]);

function imageError(code) {
  return Object.assign(new Error(code), { code });
}

function imageErrorMessage(code) {
  switch (code) {
    case "image_count_exceeded":
      return "이미지는 한 번에 1장만 첨부할 수 있습니다.";
    case "image_size_exceeded":
      return "이미지는 5MB 이하만 첨부할 수 있습니다.";
    case "image_type_unsupported":
      return "이미지는 JPG, PNG, WebP 형식만 첨부할 수 있습니다.";
    default:
      return "이미지를 확인할 수 없습니다. 다른 이미지를 선택해 주세요.";
  }
}

function decodedByteLength(base64Payload) {
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(base64Payload))
    throw imageError("image_data_invalid");
  return Buffer.from(base64Payload, "base64").length;
}

function validateSafetyImageAttachments(attachments = []) {
  if (!Array.isArray(attachments)) throw imageError("image_attachment_invalid");
  if (attachments.length === 0) return [];
  if (attachments.length > 1) throw imageError("image_count_exceeded");

  const attachment = attachments[0];
  const inputMime = String(attachment?.mime || "").toLowerCase();
  if (!ALLOWED_IMAGE_MIME_TYPES.has(inputMime))
    throw imageError("image_type_unsupported");

  const mime = inputMime === "image/jpg" ? "image/jpeg" : inputMime;
  const contentString = attachment?.contentString;
  if (typeof contentString !== "string")
    throw imageError("image_data_invalid");

  const match = contentString.match(/^data:(image\/(?:jpeg|jpg|png|webp));base64,(.+)$/i);
  if (!match || match[1].toLowerCase() !== inputMime)
    throw imageError("image_data_invalid");
  if (decodedByteLength(match[2]) > MAX_IMAGE_BYTES)
    throw imageError("image_size_exceeded");

  const normalizedContent =
    inputMime === "image/jpg"
      ? contentString.replace(/^data:image\/jpg;/i, "data:image/jpeg;")
      : contentString;
  return [{ mime, contentString: normalizedContent }];
}

function buildGroundedMultimodalMessages(generationPrompt, attachments = []) {
  if (!attachments.length)
    return [{ role: "user", content: generationPrompt }];

  const groundedImageInstruction = [
    generationPrompt,
    "",
    "[이미지 입력 안전 규칙]",
    "이미지는 질문의 상황을 이해하기 위한 보조 입력일 뿐입니다.",
    "모든 임상 사실은 제공된 SourceUnit에 명시적으로 근거해야 합니다.",
    "이미지에만 보이는 숫자, 상태, 판단을 임상 지침처럼 답변에 추가하지 마세요.",
    "등록된 병원 근거로 답할 수 없으면 근거 없는 내용을 생성하지 마세요.",
  ].join("\n");

  return [
    {
      role: "user",
      content: [
        { type: "text", text: groundedImageInstruction },
        {
          type: "image_url",
          image_url: { url: attachments[0].contentString, detail: "high" },
        },
      ],
    },
  ];
}

function attachmentsForChatRecord(attachments = [], safetyEnabled = false) {
  return safetyEnabled ? [] : attachments;
}

module.exports = {
  ALLOWED_IMAGE_MIME_TYPES,
  MAX_IMAGE_BYTES,
  attachmentsForChatRecord,
  buildGroundedMultimodalMessages,
  imageErrorMessage,
  validateSafetyImageAttachments,
};
