const test = require("node:test");
const assert = require("node:assert/strict");

const {
  convertToChatHistory,
} = require("../../../utils/helpers/chat/responses");

const presentation = {
  kind: "procedure",
  summary: "수혈은 확인 순서에 따라 진행합니다.",
  sections: [
    {
      title: "환자 확인",
      items: [{ text: "환자명을 확인합니다.", sourceIndexes: [1] }],
    },
  ],
};

test("saved procedure presentation survives chat history conversion", () => {
  const history = convertToChatHistory([
    {
      id: 1,
      prompt: "수혈 절차",
      response: JSON.stringify({
        text: "수혈은 확인 순서에 따라 진행합니다.",
        sources: [{ title: "지침.pdf · p.7" }],
        presentation,
        type: "chat",
      }),
      createdAt: new Date("2026-09-24T00:00:00Z"),
    },
  ]);

  assert.deepEqual(history[1].presentation, presentation);
});

test("plain saved answers remain valid without presentation", () => {
  const history = convertToChatHistory([
    {
      id: 2,
      prompt: "일반 질문",
      response: JSON.stringify({ text: "기존 답변", sources: [], type: "chat" }),
      createdAt: new Date("2026-09-24T00:00:00Z"),
    },
  ]);

  assert.equal(history[1].content, "기존 답변");
  assert.equal(history[1].presentation, undefined);
});

test("saved related images survive chat history conversion without internal paths", () => {
  const relatedImages = [
    {
      imageKey: "a".repeat(64),
        documentName: "병원지침.pdf",
        page: 117,
        section: "수혈 절차",
        matchType: "image_description",
      },
  ];
  const history = convertToChatHistory([
    {
      id: 3,
      prompt: "수혈 절차",
      response: JSON.stringify({
        text: "답변",
        sources: [],
        relatedImages,
        type: "chat",
      }),
      createdAt: new Date("2026-09-25T00:00:00Z"),
    },
  ]);

  assert.deepEqual(history[1].relatedImages, relatedImages);
  assert.equal(JSON.stringify(history[1]).includes("storage_relative_path"), false);
});
