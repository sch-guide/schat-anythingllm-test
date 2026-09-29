const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const searchCache = require("../../../../utils/vectorDbProviders/chroma/searchCache");
const {
  rankByBm25,
} = require("../../../../utils/vectorDbProviders/chroma/schatBm25");
const {
  skipToolsAfterForcedSearch,
} = require("../../../../utils/agents/aibitat/utils/hospitalDocumentIntent");

// Synthetic chunks only.
const docs = [
  {
    id: "a",
    text: "가상 수혈 확인 절차 첫 단계",
    metadata: { page: 1, section: "가상 수혈" },
  },
  {
    id: "b",
    text: "가상 수혈 부작용 관찰 방법",
    metadata: { page: 2, section: "관찰" },
  },
  {
    id: "c",
    text: "가상 투약 기록 방법",
    metadata: { page: 3, section: "투약" },
  },
  {
    id: "d",
    text: "가상 수혈 세트 교환",
    metadata: { page: 4, section: "수혈 세트" },
  },
].map((d, i) => ({ ...d, corpusPosition: i }));

test("BM25 gives identical rankings when its token index is reused", () => {
  for (const q of ["수혈", "수혈 세트", "관찰 방법", "투약", "없는단어"]) {
    const fresh = rankByBm25(
      q,
      docs.map((d) => ({ ...d }))
    );
    const first = rankByBm25(q, docs);
    const reused = rankByBm25(q, docs); // same array -> cached index
    assert.deepEqual(first, fresh, q);
    assert.deepEqual(reused, fresh, q);
  }
  // results never expose the internal token fields
  const [top] = rankByBm25("수혈", docs);
  assert.equal("tokens" in top, false);
  assert.equal("tokenCount" in top, false);
});

function fakeCollection() {
  const state = { ids: ["x1", "x2"], fullLoads: 0 };
  return {
    state,
    async get({ include }) {
      if (include.length === 0) return { ids: [...state.ids] };
      state.fullLoads += 1;
      return {
        ids: [...state.ids],
        documents: state.ids.map((id) => `doc ${id}`),
        metadatas: state.ids.map((id) => ({ id })),
      };
    },
  };
}

test("the corpus is reused only while the collection is unchanged", async () => {
  delete process.env.SCHAT_SEARCH_CACHE;
  searchCache.invalidate();
  const col = fakeCollection();
  const first = await searchCache.loadCorpus(col, "ns-a");
  const second = await searchCache.loadCorpus(col, "ns-a");
  assert.equal(col.state.fullLoads, 1);
  assert.equal(second.version, first.version);

  col.state.ids.push("x3"); // added by any process (e.g. a backfill script)
  const third = await searchCache.loadCorpus(col, "ns-a");
  assert.equal(col.state.fullLoads, 2);
  assert.notEqual(third.version, first.version);

  col.state.ids = ["y1", "y2", "y3"]; // replaced with the same count
  await searchCache.loadCorpus(col, "ns-a");
  assert.equal(col.state.fullLoads, 3);

  searchCache.invalidate("ns-a"); // in-process write
  await searchCache.loadCorpus(col, "ns-a");
  assert.equal(col.state.fullLoads, 4);

  // never older than the TTL (covers in-place metadata edits)
  searchCache._state.corpora.get("ns-a").loadedAt -=
    searchCache.CORPUS_TTL_MS + 1;
  await searchCache.loadCorpus(col, "ns-a");
  assert.equal(col.state.fullLoads, 5);

  process.env.SCHAT_SEARCH_CACHE = "off";
  const off1 = await searchCache.loadCorpus(col, "ns-a");
  await searchCache.loadCorpus(col, "ns-a");
  assert.equal(col.state.fullLoads, 7);
  assert.equal(off1.version, null);
  delete process.env.SCHAT_SEARCH_CACHE;
});

test("embeddings and search results are cached as copies", async () => {
  searchCache.invalidate();
  let calls = 0;
  const connector = {
    embedder: { model: "virtual-embedder" },
    embedTextInput: async () => {
      calls += 1;
      return [0.1, 0.2, 0.3];
    },
  };
  const v1 = await searchCache.embedWithCache(connector, "가상 질문");
  v1[0] = 999; // a caller changing its copy must not change the cache
  const v2 = await searchCache.embedWithCache(connector, "가상 질문");
  assert.equal(calls, 1);
  assert.deepEqual(v2, [0.1, 0.2, 0.3]);

  const key = searchCache.searchKey(["ns", "v1", "가상 질문"]);
  const value = { contextTexts: ["a"], sources: [{ page: 1 }] };
  searchCache.setSearch(key, value);
  value.sources[0].page = 99;
  const hit = searchCache.getSearch(key);
  assert.deepEqual(hit, { contextTexts: ["a"], sources: [{ page: 1 }] });
  hit.sources[0].page = 42;
  assert.equal(searchCache.getSearch(key).sources[0].page, 1);

  searchCache.invalidate(); // any document change drops search results
  assert.equal(searchCache.getSearch(key), null);
});

test("every Chroma write path clears the search caches", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "../../../../utils/vectorDbProviders/chroma/index.js"),
    "utf8"
  );
  for (const method of [
    "smartAdd",
    "smartDelete",
    "deleteVectorsInNamespace",
    "reset",
  ]) {
    const start = source.indexOf(`async ${method}(`);
    assert.ok(start > 0, method);
    const body = source.slice(start, source.indexOf("\n  }\n", start));
    assert.match(body, /searchCache\.invalidate\(/, method);
  }
});

test("re-search option A is off unless explicitly enabled", () => {
  assert.equal(skipToolsAfterForcedSearch({}), false);
  assert.equal(
    skipToolsAfterForcedSearch({
      SCHAT_AGENT_SKIP_TOOLS_AFTER_FORCED_SEARCH: "false",
    }),
    false
  );
  assert.equal(
    skipToolsAfterForcedSearch({
      SCHAT_AGENT_SKIP_TOOLS_AFTER_FORCED_SEARCH: "true",
    }),
    true
  );
  const aibitat = fs.readFileSync(
    path.join(__dirname, "../../../../utils/agents/aibitat/index.js"),
    "utf8"
  );
  // only when the forced search found evidence
  assert.match(
    aibitat,
    /forcedRagContext &&\s*skipToolsAfterForcedSearch\(\) &&\s*\(this\.getRagMemorySources\?\.\(\) \|\| \[\]\)\.length > 0/
  );
});
