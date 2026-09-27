const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildChatSearchQueries,
} = require("../../../utils/chats/searchQueries.js");

test("chat keeps the expanded query for body evidence and the exact user question for images", () => {
  const result = buildChatSearchQueries({
    originalQuestion: "NRS 통증척도는 어떻게 평가해?",
    expandedBodyQuery: "NRS 숫자 통증 척도 평가 방법 사정 시행",
  });

  assert.deepEqual(result, {
    bodySearchQuery: "NRS 숫자 통증 척도 평가 방법 사정 시행",
    relatedImageSearchQuery: "NRS 통증척도는 어떻게 평가해?",
  });
});
