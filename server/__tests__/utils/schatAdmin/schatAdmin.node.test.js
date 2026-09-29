const test = require("node:test");
const assert = require("node:assert/strict");

const {
  summarizeDocuments,
  summarizeChecklists,
  checkGeminiConnection,
  publicConnectionState,
} = require("../../../utils/schatAdmin");

test("pages of one PDF count as one registered file", () => {
  assert.deepEqual(
    summarizeDocuments([
      "custom-documents/a.pdf-page-1-11.json",
      "custom-documents/a.pdf-page-2-22.json",
      "custom-documents/b.pdf-page-1-33.json",
      "custom-documents/note.txt-44.json",
    ]),
    { files: 3, pages: 4 }
  );
  assert.deepEqual(summarizeDocuments([]), { files: 0, pages: 0 });
});

test("checklists needing review are counted separately", () => {
  assert.deepEqual(
    summarizeChecklists([
      { status: "active", active: true },
      { status: "needs_review", active: false },
      { active: true },
      { status: "hidden", active: false },
    ]),
    { total: 4, active: 2, review: 1, hidden: 1 }
  );
});

test("connection state sent to the browser never includes a key", () => {
  const state = publicConnectionState({
    LLM_PROVIDER: "gemini",
    GEMINI_LLM_MODEL_PREF: "model-a",
    GEMINI_API_KEY: "secret-llm",
    EMBEDDING_ENGINE: "gemini",
    EMBEDDING_MODEL_PREF: "embed-a",
  });
  assert.equal(JSON.stringify(state).includes("secret"), false);
  assert.equal(state.llm.keySet, true);
  assert.equal(state.embedding.keySet, false);
  assert.equal(state.embedding.model, "embed-a");
  assert.equal(state.sharedKey, false);
  const shared = publicConnectionState({
    GEMINI_API_KEY: "same-secret",
    GEMINI_EMBEDDING_API_KEY: "same-secret",
  });
  assert.equal(shared.sharedKey, true);
  assert.equal(JSON.stringify(shared).includes("secret"), false);
});

test("connection test sends the key as a header only and maps statuses", async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    return { ok: false, status: 403 };
  };
  const result = await checkGeminiConnection({
    apiKey: "secret-key",
    model: "models/model-a",
    fetchImpl,
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, "unauthorized");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url.includes("secret-key"), false);
  assert.match(calls[0].url, /\/models\/model-a$/);
  assert.equal(calls[0].options.headers["x-goog-api-key"], "secret-key");
  assert.equal(calls[0].options.body, undefined);
  assert.equal(JSON.stringify(result).includes("secret"), false);

  const ok = await checkGeminiConnection({
    apiKey: "k",
    model: "m",
    fetchImpl: async () => ({ ok: true, status: 200 }),
  });
  assert.deepEqual([ok.ok, ok.code], [true, "ok"]);
  const missing = await checkGeminiConnection({
    apiKey: null,
    model: "m",
    fetchImpl: () => assert.fail("must not call without a key"),
  });
  assert.equal(missing.code, "missing_key");
  const failed = await checkGeminiConnection({
    apiKey: "k",
    model: "m",
    fetchImpl: async () => {
      throw new Error("network down secret");
    },
  });
  assert.equal(failed.code, "failed");
  assert.equal(failed.message.includes("secret"), false);
});
