const test = require("node:test");
const assert = require("node:assert/strict");
const AIbitat = require("../../../../utils/agents/aibitat");
const { memory } = require("../../../../utils/agents/aibitat/plugins/memory");

test("다음 답변에서는 같은 질문을 다시 검색하되 답변 내 중복·중복 저장은 막음", async () => {
  const ai = new AIbitat({ provider: "openai" });
  let tool;
  const register = ai.function.bind(ai);
  ai.function = (config) => {
    config.search = async () => {
      ai.addRagMemorySources([{ id: "synthetic", title: "시험.txt", text: "가짜 역격리 이동 근거" }]);
      return "가짜 역격리 이동 근거";
    };
    config.store = async () => "stored";
    tool = config;
    return register(config);
  };
  memory.plugin().setup(ai);
  const query = { action: "search", content: "역격리 이동 시" };
  assert.equal(await tool.handler(query), "가짜 역격리 이동 근거");
  assert.match(await tool.handler(query), /duplicated/);
  assert.equal(await tool.handler({ action: "store", content: "synthetic" }), "stored");
  ai.clearCitations();
  assert.equal(await tool.handler(query), "가짜 역격리 이동 근거");
  assert.equal(ai.getRagMemorySources().length, 1);
  assert.match(await tool.handler(query), /duplicated/);
  assert.match(await tool.handler({ action: "store", content: "synthetic" }), /duplicated/);
});
