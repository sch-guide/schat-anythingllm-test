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

test("명시적 재시도 0은 SDK 요청 옵션으로만 전달하고 일반 요청 기본값은 유지한다", async () => {
  const { GeminiLLM } = provider();
  const llm = Object.create(GeminiLLM.prototype);
  llm.model = "gemini-test";
  const requests = [];
  llm.openai = {
    chat: {
      completions: {
        create: async (body, options) => {
          requests.push({ body, options });
          return {
            choices: [{ message: { content: "가짜 답변" } }],
            usage: {},
          };
        },
      },
    },
  };
  await llm.getChatCompletion([], { maxRetries: 0 });
  await llm.getChatCompletion([]);
  assert.equal(requests[0].options?.maxRetries, 0);
  assert.equal(Object.hasOwn(requests[0].body, "maxRetries"), false);
  assert.equal(requests[1].options, undefined);
});

test("C는 SDK 기본 재시도 2회를 끄고 문서 변경·삭제 확인을 우회하는 재전송을 막는다", async () => {
  for (const mutation of ["changed", "deleted"]) {
    const Suggestions = require("../../utils/synonyms/suggestions");
    const documents = [
      {
        documentId: "fake-sdk-doc",
        documentName: "가짜 SDK 문서.pdf",
        pages: [
          {
            page: 1,
            pageContent:
              "가짜 용어 TEST 관리\n가짜 절차 STEP 확인\n가짜 약물 DRUG 준비\n" +
              "가짜 문서 설명 ".repeat(20),
          },
        ],
      },
    ];
    let savedRun;
    const prisma = {
      schat_synonym_suggestion_runs: {
        create: async ({ data }) => (savedRun = { id: 1, ...data }),
        update: async ({ data }) => Object.assign(savedRun, data),
        findUnique: async () => ({ ...savedRun }),
        updateMany: async ({ where, data }) => {
          if (savedRun.status !== where.status) return { count: 0 };
          Object.assign(savedRun, data);
          return { count: 1 };
        },
      },
      schat_synonym_groups: { findMany: async () => [] },
      schat_synonym_suggestions: { findMany: async () => [] },
      users: { findMany: async () => [] },
      $transaction: async (callback) => callback(prisma),
    };
    const base = {
      prisma,
      logger: null,
      logEvent: async () => null,
      delays: [],
    };
    await Suggestions.suggestForDocuments(documents, {
      ...base,
      llm: {
        getChatCompletion: async () => {
          throw new Error("timeout");
        },
      },
    });
    const { GeminiLLM } = provider();
    const llm = Object.create(GeminiLLM.prototype);
    llm.model = "gemini-test";
    let transmissions = 0;
    let receivedOptions;
    llm.openai = {
      chat: {
        completions: {
          create: async (_body, options) => {
            receivedOptions = options;
            // 설치된 SDK의 options.maxRetries ?? 기본값 2 경계를 가짜 전송으로 재현한다.
            const retries = options?.maxRetries ?? 2;
            for (let attempt = 0; attempt <= retries; attempt++) {
              transmissions++;
              if (attempt === 0) {
                if (mutation === "changed")
                  documents[0].pages[0].pageContent += "변경";
                else documents.splice(0);
                if (attempt === retries) throw new Error("503 unavailable");
                continue;
              }
              return {
                choices: [{ message: { content: '{"groups":[]}' } }],
                usage: {},
              };
            }
          },
        },
      },
    };
    const result = await Suggestions.retryRun(1, {
      ...base,
      llm,
      delays: [1],
      sleep: async () => null,
      loadCurrentDocuments: async () => documents,
    });
    assert.equal(transmissions, 1);
    assert.equal(receivedOptions?.maxRetries, 0);
    assert.equal(result.rows[0].error, "document_changed");
  }
});
