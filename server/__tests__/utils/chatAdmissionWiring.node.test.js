const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { EventEmitter } = require("node:events");
const { createAdmission } = require("../../utils/chatAdmission");
const session = require("../../utils/chatAdmissionSession");
const tick = () => new Promise((resolve) => setImmediate(resolve));
function load(file, deps) {
  const module = { exports: {} };
  vm.runInNewContext(
    fs.readFileSync(path.resolve(__dirname, "../..", file), "utf8"),
    {
      module,
      exports: module.exports,
      console: { log() {}, error() {} },
      process: { env: {} },
      require: (name) => {
        if (name in deps) return deps[name];
        throw Error(`Unexpected dependency ${name}`);
      },
    }
  );
  return module.exports;
}
class Socket extends EventEmitter {
  constructor() {
    super();
    this.OPEN = 1;
    this.readyState = 1;
    this.messages = [];
  }
  send(text) {
    this.messages.push(JSON.parse(text));
  }
  close() {
    if (this.readyState === 3) return;
    this.readyState = 3;
    this.emit("close");
  }
}
function agentSetup(
  gate,
  { create = async () => {}, start = async () => {} } = {}
) {
  const handlers = [];
  let route;
  class Handler {
    constructor({ uuid }) {
      this.id = uuid;
      this.invocation = { user_id: uuid };
      handlers.push(this);
    }
    async init() {
      return this;
    }
    async createAIbitat() {
      await create(this);
      this.aibitat = {
        abort: () => {
          this.aborted = true;
        },
      };
    }
    async startAgentCluster() {
      this.started = true;
      await start(this);
    }
    closeAlert() {}
    log() {}
  }
  load("endpoints/agentWebsocket.js", {
    "../models/telemetry": { Telemetry: { sendTelemetry: async () => {} } },
    "../models/workspaceAgentInvocation": {
      WorkspaceAgentInvocation: { close: async () => {} },
    },
    "../utils/agents": { AgentHandler: Handler },
    "../utils/agents/aibitat/plugins/websocket": {
      WEBSOCKET_BAIL_COMMANDS: ["/exit"],
    },
    "../utils/http": { safeJsonParse: JSON.parse },
    "../utils/chatAdmissionRuntime": { runtime: { ready: async () => gate } },
    "../utils/chatAdmissionSession": session,
    "../utils/chatAdmissionContext": require("../../utils/chatAdmissionContext"),
  }).agentWebsocket({ ws: (_, handler) => (route = handler) });
  return {
    handlers,
    connect: (id, socket) => route(socket, { params: { uuid: id } }),
  };
}
test("real Agent route shares HTTP gate, reports queue, closes and admits next user", async () => {
  const gate = createAdmission();
  gate.configure({ maxActive: 1 });
  const normal = await gate.acquire("http-user");
  const app = agentSetup(gate);
  const socket = new Socket();
  const work = app.connect("agent-user", socket);
  await tick();
  assert.equal(app.handlers[0].started, undefined);
  assert.equal(socket.messages[0].position, 1);
  normal.release();
  await work;
  assert.equal(app.handlers[0].started, true);
  assert.equal(gate.snapshot().active, 1);
  socket.close();
  assert.equal(app.handlers[0].aborted, true);
  assert.equal(gate.snapshot().active, 0);
});
test("Agent disconnect during initialization cannot start late work or leak its slot", async () => {
  let finish;
  const init = new Promise((resolve) => (finish = resolve));
  const gate = createAdmission();
  const app = agentSetup(gate, { create: () => init });
  const socket = new Socket();
  const work = app.connect("u", socket);
  await tick();
  socket.close();
  finish();
  await work;
  assert.equal(app.handlers[0].started, undefined);
  assert.equal(app.handlers[0].aborted, true);
  assert.equal(gate.snapshot().active, 0);
});
test("Agent startup failure and duplicate socket do not leak or release another session", async () => {
  const gate = createAdmission();
  const app = agentSetup(gate, {
    start: async (handler) => {
      if (handler.id === "bad") throw Error("fake error");
    },
  });
  const one = new Socket();
  await app.connect("one", one);
  const duplicate = new Socket();
  await app.connect("one", duplicate);
  assert.equal(duplicate.readyState, 3);
  assert.equal(gate.snapshot().active, 1);
  await app.connect("bad", new Socket());
  assert.equal(gate.snapshot().active, 1);
  one.close();
  assert.equal(gate.snapshot().active, 0);
});
test("Agent generation deadline aborts and closes real route; slot becomes reusable", async () => {
  const timers = new Map();
  let id = 0;
  const gate = createAdmission({
    setTimer: (fn, ms) => {
      timers.set(++id, { fn, ms });
      return id;
    },
    clearTimer: (id) => timers.delete(id),
  });
  const app = agentSetup(gate);
  const socket = new Socket();
  await app.connect("u", socket);
  [...timers.values()].find((t) => t.ms === 90000).fn();
  assert.equal(app.handlers[0].aborted, true);
  assert.equal(socket.readyState, 3);
  assert.equal(socket.messages.at(-1).type, "wssFailure");
  const next = await gate.acquire("u");
  next.release();
});
test("HTTP cancelled during model selection cannot reach retrieval or generation", async () => {
  const gate = createAdmission();
  let finish;
  let retrievals = 0;
  const delayed = new Promise((resolve) => (finish = resolve));
  const response = new EventEmitter();
  response.end = () => {
    response.writableEnded = true;
    response.emit("close");
  };
  const chunks = [];
  const stream = load("utils/chats/stream.js", {
    uuid: { v4: () => "test" },
    "../DocumentManager": {},
    "../../models/workspaceChats": {},
    "../../models/workspaceParsedFiles": {},
    "../helpers": {
      resolveProviderConnector: () => delayed,
      getVectorDbClass: () => {
        retrievals++;
        throw Error("should not run");
      },
    },
    "../helpers/modelPricing": {},
    "../helpers/chat/responses": {
      writeResponseChunk: (_, data) => chunks.push(data),
    },
    "../helpers/abortSignals": require("../../utils/helpers/abortSignals"),
    "../chatAdmissionRuntime": { runtime: { ready: async () => gate } },
    "../chatAdmissionSession": session,
    "../chatAdmissionContext": require("../../utils/chatAdmissionContext"),
    "./agents": { grepAgents: async () => false },
    "./index": { grepCommand: async (x) => x, VALID_COMMANDS: {} },
    "./searchQueries": { buildChatSearchQueries: () => ({}) },
    "./expandedBodySearch": {},
    "../schatSafety/imageAttachment": {},
  });
  const work = stream.streamChatWithWorkspace(response, {}, "test", "chat", {
    id: 1,
  });
  await tick();
  assert.equal(gate.snapshot().active, 1);
  response.emit("close");
  finish({ connector: {} });
  await work;
  assert.equal(retrievals, 0);
  assert.equal(gate.snapshot().active, 0);
});
