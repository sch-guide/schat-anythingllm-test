// A stopped agent run ([멈추기], the 70-second automatic stop, a closed
// window) must not leave an empty answer row in the chat history.
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const calls = [];
let createDelay = Promise.resolve();
const fakeChats = {
  WorkspaceChats: {
    new: async () => {
      await createDelay;
      return { chat: { id: 77 } };
    },
    upsert: async (id, data) => calls.push(["upsert", id, data.response?.text]),
    delete: async (clause) => calls.push(["delete", clause]),
  },
};
const modelsDir = path.resolve(__dirname, "../../../models");
for (const [file, exports] of [
  ["workspaceChats.js", fakeChats],
  ["workspaceThread.js", { WorkspaceThread: { update: async () => null } }],
]) {
  const id = path.join(modelsDir, file);
  require.cache[id] = { id, filename: id, loaded: true, exports };
}
const {
  chatHistory,
} = require("../../../utils/agents/aibitat/plugins/chat-history");

function fakeAibitat() {
  const handlers = { message: [], abort: [] };
  const aibitat = {
    _aborted: false,
    _trackedChatId: null,
    _chats: [],
    chats: [],
    handlerProps: { invocation: { workspace_id: 1, user_id: 2, thread_id: 3 } },
    onMessage: (fn) => handlers.message.push(fn),
    onAbort: (fn) => handlers.abort.push(fn),
    registerChatId(id) { this._trackedChatId = Number(id); },
    clearTrackedChatId() { this._trackedChatId = null; },
    get trackedChatId() { return this._trackedChatId; },
    getRagMemorySources: () => [],
    providerInstance: null,
    _threadRenamed: true,
  };
  const plugin = chatHistory.plugin();
  plugin.setup.call(plugin, aibitat);
  return {
    aibitat,
    plugin,
    async userMessage(content) {
      const message = { from: "USER", content };
      aibitat.chats.push(message);
      for (const fn of handlers.message) await fn(message);
    },
    async agentMessage(content) {
      const message = { from: "@agent", content };
      aibitat.chats.push(message);
      for (const fn of handlers.message) await fn(message);
    },
    abort: () => handlers.abort.forEach((fn) => fn()),
  };
}

test("stopping before the answer removes the empty pre-registered row", async () => {
  calls.length = 0;
  const run = fakeAibitat();
  await run.userMessage("세프트리악손 AST 해야 해?");
  run.abort();
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(calls, [["delete", { id: 77, response: "{}" }]]);
});

test("a saved answer is never removed by a later stop", async () => {
  calls.length = 0;
  const run = fakeAibitat();
  await run.userMessage("진정간호 목적은?");
  await run.agentMessage("진정간호의 목적은 …");
  run.abort();
  await new Promise((r) => setImmediate(r));
  assert.equal(calls.filter(([kind]) => kind === "delete").length, 0);
  assert.equal(calls.filter(([kind]) => kind === "upsert").length, 1);
});

test("stopping while the row is still being created removes it once created", async () => {
  calls.length = 0;
  let release;
  createDelay = new Promise((r) => { release = r; });
  const run = fakeAibitat();
  const pending = run.userMessage("수혈 종류");
  run.abort();
  release();
  await pending;
  createDelay = Promise.resolve();
  assert.deepEqual(calls.filter(([kind]) => kind === "delete"), [["delete", { id: 77, response: "{}" }]]);
});

test("only an empty row can match the delete condition", () => {
  // The condition includes response "{}" so a row that already holds an
  // answer can never be deleted, even if the timing overlaps.
  const { forgetUnansweredChat } = require("../../../utils/agents/aibitat/plugins/chat-history");
  calls.length = 0;
  forgetUnansweredChat({ trackedChatId: 5 });
  assert.deepEqual(calls, [["delete", { id: 5, response: "{}" }]]);
  calls.length = 0;
  assert.equal(forgetUnansweredChat({ trackedChatId: null }), null);
  assert.equal(calls.length, 0);
});
