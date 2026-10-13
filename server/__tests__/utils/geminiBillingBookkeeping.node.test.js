const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const fees = require("../../utils/aiUsageFees");
const root = path.resolve(__dirname, "../../utils");
function load(file, deps = {}) {
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(root, file), "utf8"), {
    module,
    exports: module.exports,
    console,
    process: { env: {} },
    Date,
    Buffer,
    URL,
    __dirname: path.dirname(path.join(root, file)),
    require: (name) => (name in deps ? deps[name] : {}),
  });
  return module.exports;
}
const usage = { prompt_tokens: 100, completion_tokens: 20, total_tokens: 150 };
function persistence() {
  let saved;
  const { safeJSONStringify } = load('helpers/chat/responses.js', { uuid: {v4:()=> 'fake'} });
  const {WorkspaceChats} = load('../models/workspaceChats.js', {
    '../utils/prisma': {workspace_chats: {
      findFirst:async()=>saved ? {response:saved.response} : null,
      create:async({data})=>{saved=data;return{id:1,...data};},
      upsert:async({update})=>{saved=update;return{id:1,...update};},
    }},
    '../utils/helpers/chat/responses': {safeJSONStringify},
    '../utils/chatSearchOutcome': require('../../utils/chatSearchOutcome'),
  });
  return {WorkspaceChats, saved:()=>JSON.parse(saved.response)};
}
test("ordinary stream reads terminal usage after finish and keeps raw total before monitor overwrite", async () => {
  const { LLMPerformanceMonitor: Monitor } = load(
    "helpers/chat/LLMPerformanceMonitor.js",
    {
      "../tiktoken": { TokenManager: class {} },
      "../../aiUsageFees": fees,
    }
  );
  const { handleDefaultStreamResponseV2: handle } = load(
    "helpers/chat/responses.js",
    {
      uuid: { v4: () => "fake" },
      "../abortSignals": { isAbortError: () => false },
    }
  );
  let clientClosed = false;
  async function* chunks() {
    yield { choices: [{ delta: { content: "답변" }, finish_reason: null }] };
    yield { choices: [{ delta: {}, finish_reason: "stop" }] };
    if (clientClosed) return; // the client closes when it receives close:true
    yield { choices: [], usage };
    yield { choices: [], usage }; // repeated final telemetry must not double count
  }
  const stream = await Monitor.measureStream({
    func: Promise.resolve(chunks()),
    runPromptTokenCalculation: false,
    modelTag: "gemini-3.8-flash",
    provider: "GeminiLLM",
  });
  const response = { on() {}, removeListener() {}, write(data) { if (JSON.parse(data.slice(6)).close) clientClosed = true; } };
  assert.equal(await handle(response, stream, {}), "답변");
  assert.equal(stream.metrics.geminiBilling.calls.length, 1);
  assert.equal(stream.metrics.geminiBilling.calls[0].raw.total_tokens, 150);
  assert.equal(stream.metrics.geminiBilling.calls[0].outputTokens, 50);
});
test("ordinary nonstream preserves raw usage without depending on legacy monitoring totals", async () => {
  const { GeminiLLM } = load("AiProviders/gemini/index.js", {
    fs: { existsSync: () => true },
    path,
    "../../helpers/chat/LLMPerformanceMonitor": {
      LLMPerformanceMonitor: {
        measureAsyncFunction: async (promise) => ({
          output: await promise,
          duration: 1,
        }),
      },
    },
    "../../aiUsageFees": fees,
  });
  const llm = Object.create(GeminiLLM.prototype);
  llm.model = "gemini-3.8-flash";
  llm.className = "GeminiLLM";
  llm.openai = {
    chat: {
      completions: {
        create: async () => ({
          choices: [{ message: { content: "답변" } }],
          usage,
        }),
      },
    },
  };
  const result = await llm.getChatCompletion([], {});
  assert.equal(result.textResponse, "답변");
  assert.equal(result.metrics.geminiBilling.calls[0].raw.total_tokens, 150);
  const db=persistence();
  await db.WorkspaceChats.new({workspaceId:1,prompt:'가짜 질문',response:{text:result.textResponse,metrics:result.metrics}});
  assert.equal(db.saved().metrics.geminiBilling.calls[0].raw.total_tokens,150);
});
test("agent cumulative accounting records one entry per completion and missing subcalls remain incomplete", async () => {
  const Provider = load("agents/aibitat/providers/ai-provider.js", {
    "../../../helpers/numbers": {
      toNonNegativeNumber: (n) =>
        Number.isFinite(Number(n)) && Number(n) > 0 ? Number(n) : 0,
    },
    "../../../helpers/modelPricing": {
      MODEL_PRICING: { getCostBreakdown: () => null },
    },
  });
  class FakeSDK {
    constructor() {
      this.chat = { completions: {} };
    }
  }
  const Gemini = load("agents/aibitat/providers/gemini.js", {
    "./ai-provider.js": Provider,
    openai: FakeSDK,
    "../../../aiUsageFees": fees,
    "../../../geminiDailyUsage": {
      countingFetch: () => () => {},
      dailyUsage: {},
    },
    "../../../geminiAvailability": { observeCreate() {} },
    "../../../http": {
      safeJsonParse: (value, fallback) => {
        try {
          return JSON.parse(value);
        } catch {
          return fallback;
        }
      },
    },
    uuid: { v4: () => "fake" },
  });
  const agent = new Gemini({ model: "gemini-3.8-flash" });
  agent.verbose = false;
  agent.client.chat.completions.create = async () => ({
    choices: [{ message: { content: "답변" } }],
    usage,
  });
  await agent.complete([]);
  agent.client.chat.completions.create = async () => ({
    choices: [{ message: { content: "답변" } }],
  });
  await agent.complete([]);
  const billing = agent.getCumulativeUsage().geminiBilling;
  assert.equal(billing.calls.length, 2);
  assert.equal(billing.calls[0].complete, true);
  assert.equal(billing.calls[1].complete, false);
  agent.client.chat.completions.create=async()=> (async function*(){
    yield{choices:[{delta:{content:'답변'}}],usage};
    yield{choices:[],usage};
  })();
  await agent.stream([]);
  assert.equal(agent.getCumulativeUsage().geminiBilling.calls.length,3);
  const db=persistence();
  const {chatHistory}=load('agents/aibitat/plugins/chat-history.js',{'../../../../models/workspaceChats':db});
  const plugin=chatHistory.plugin();
  await plugin._store({handlerProps:{invocation:{workspace_id:1,user_id:1}},providerInstance:agent,trackedChatId:1,_threadRenamed:true,clearTrackedChatId(){}}, {prompt:'가짜 질문',response:'가짜 답변'});
  assert.equal(db.saved().metrics.geminiBilling.calls.length,3);
  assert.equal(db.saved().metrics.geminiBilling.calls[1].complete,false);
  assert.equal(
    fees.estimateChatCost([
      { response: JSON.stringify({ metrics: agent.getCumulativeUsage() }) },
    ]).estimatedKrw,
    null
  );
  agent.resetCumulativeUsage();
  assert.equal(agent.getCumulativeUsage().geminiBilling.calls.length, 0);
});
