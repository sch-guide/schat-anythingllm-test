const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const fs = require("node:fs");
const path = require("node:path");
const { EventEmitter } = require("node:events");
const { createAdmission } = require("../../utils/chatAdmission");
const { openSession } = require("../../utils/chatAdmissionSession");
const context = require("../../utils/chatAdmissionContext");
test("real Gemini embedder cancels current SDK request and rejects subsequent search calls", async () => {
  let calls = 0;
  let observed;
  class SDK {
    constructor() {
      this.embeddings = {
        create: (_body, options) => {
          calls++;
          observed = options.signal;
          return new Promise((resolve, reject) =>
            options.signal.addEventListener(
              "abort",
              () => reject(new Error("cancelled")),
              { once: true }
            )
          );
        },
      };
    }
  }
  const deps = {
    "../../helpers": {
      toChunks: (items) => [items],
      reportEmbeddingProgress() {},
    },
    openai: { OpenAI: SDK },
    "../../geminiAvailability": { observeCreate() {} },
    "../../helpers/abortSignals": require("../../utils/helpers/abortSignals"),
    "../../chatAdmissionContext": context,
  };
  const module = { exports: {} };
  vm.runInNewContext(
    fs.readFileSync(
      path.resolve(__dirname, "../../utils/EmbeddingEngines/gemini/index.js"),
      "utf8"
    ),
    {
      module,
      exports: module.exports,
      process: { env: { GEMINI_API_KEY: "synthetic-test-not-a-key" } },
      console: { log() {} },
      require: (name) => {
        if (name in deps) return deps[name];
        throw Error(name);
      },
    }
  );
  const gate = createAdmission();
  const transport = new EventEmitter();
  const session = await openSession(gate, "one", transport);
  const embedder = context.withAdmissionSignal(
    session.signal,
    () => new module.exports.GeminiEmbedder()
  );
  const request = embedder.embedTextInput("synthetic");
  transport.emit("close");
  await assert.rejects(request, /cancelled/);
  assert.equal(observed.aborted, true);
  await assert.rejects(embedder.embedTextInput("next synthetic"));
  assert.equal(calls, 1);
  assert.equal(gate.snapshot().active, 0);
});
