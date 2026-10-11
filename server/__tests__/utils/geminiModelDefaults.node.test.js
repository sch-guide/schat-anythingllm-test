const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

// 외부 SDK·DB·통신은 로드하지 않고 실제 Gemini 요청 생성 함수를 실행한다.
function provider() {
  const file = path.resolve(
    __dirname,
    "../../utils/AiProviders/gemini/index.js"
  );
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(file, "utf8"), {
    module,
    exports: module.exports,
    __dirname: path.dirname(file),
    process,
    require(name) {
      if (name === "fs") return fs;
      if (name === "path") return path;
      if (name === "../../aiUsageFees")
        return { normalizeGeminiUsage: () => ({}) };
      if (name.includes("LLMPerformanceMonitor"))
        return {
          LLMPerformanceMonitor: {
            measureAsyncFunction: async (promise) => ({
              output: await promise,
              duration: 1,
            }),
            measureStream: async ({ func }) => await func,
          },
        };
      return {};
    },
  });
  return module.exports;
}

test("저장된 온도 2와 seed는 일반·스트리밍 Gemini 요청에 전달하지 않는다", async () => {
  const { GeminiLLM, buildGeminiChatRequest } = provider();
  const requests = [];
  const llm = Object.create(GeminiLLM.prototype);
  llm.model = "gemini-test";
  llm.openai = {
    chat: {
      completions: {
        create: async (request) => {
          requests.push(request);
          return {
            choices: [{ message: { content: "가짜 답변" } }],
            usage: {},
          };
        },
      },
    },
  };
  const messages = [{ role: "user", content: "가짜 질문" }];
  const schema = { type: "object" };
  await llm.getChatCompletion(messages, {
    temperature: 2,
    seed: 42,
    responseSchema: schema,
  });
  await llm.streamGetChatCompletion(messages, { temperature: 2, seed: 42 });
  requests.push(
    buildGeminiChatRequest({
      model: llm.model,
      messages,
      temperature: 2,
      seed: 42,
    })
  );
  for (const request of requests) {
    assert.equal(Object.hasOwn(request, "temperature"), false);
    assert.equal(Object.hasOwn(request, "seed"), false);
    assert.equal(request.model, "gemini-test");
    assert.equal(request.messages, messages);
  }
  assert.equal(requests[0].response_format.json_schema.schema, schema);
  assert.equal(requests[1].stream, true);
  assert.equal(requests[1].stream_options.include_usage, true);
});
