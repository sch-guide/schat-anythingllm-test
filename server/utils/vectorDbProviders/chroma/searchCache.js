// SCHAT search speed-up caches (results must stay identical to no cache).
//
// - Corpus: the full body/image-description chunk list BM25 needs. Reused
//   while the collection is unchanged; checked on EVERY search by a cheap
//   ids-only fingerprint (catches adds/deletes/replacements from any process),
//   cleared at once by in-process writes (invalidate), and never older than
//   CORPUS_TTL_MS (covers rare in-place metadata edits by admin scripts).
// - Embeddings: same model + same text -> same vector (documents don't matter).
// - Search results: same inputs on the same corpus version -> same result.
//   Returned as deep copies so callers can never change a cached value.
// Set SCHAT_SEARCH_CACHE=off to disable all three (fallback to fresh loads).
const crypto = require("node:crypto");

const CORPUS_TTL_MS = 60 * 1000;
const SEARCH_TTL_MS = 10 * 60 * 1000;
const MAX_SEARCH_ENTRIES = 200;
const MAX_EMBEDDING_ENTRIES = 1000;

const state = {
  generation: 0,
  corpora: new Map(), // namespace -> { fingerprint, generation, loadedAt, stored, byFilter }
  searches: new Map(), // key -> { at, value }
  embeddings: new Map(), // key -> vector
};

function enabled() {
  return String(process.env.SCHAT_SEARCH_CACHE || "on").toLowerCase() !== "off";
}

/** Any Chroma write in this process: drop corpora and search results. */
function invalidate(namespace = null) {
  state.generation += 1;
  if (namespace) state.corpora.delete(namespace);
  else state.corpora.clear();
  state.searches.clear();
}

function remember(map, key, value, limit) {
  if (map.has(key)) map.delete(key);
  map.set(key, value);
  while (map.size > limit) map.delete(map.keys().next().value);
}

async function fingerprintOf(collection) {
  const { ids = [] } = await collection.get({ include: [] });
  return crypto
    .createHash("sha1")
    .update(`${ids.length}:${[...ids].sort().join(",")}`)
    .digest("hex");
}

/**
 * Stored chunks for a namespace ({ ids, documents, metadatas }) plus a
 * version string that changes whenever the stored chunks may have changed.
 */
async function loadCorpus(collection, namespace) {
  const load = () => collection.get({ include: ["documents", "metadatas"] });
  if (!enabled()) return { stored: await load(), version: null, entry: null };
  const fingerprint = await fingerprintOf(collection);
  const cached = state.corpora.get(namespace);
  if (
    cached &&
    cached.fingerprint === fingerprint &&
    cached.generation === state.generation &&
    Date.now() - cached.loadedAt < CORPUS_TTL_MS
  )
    return { stored: cached.stored, version: cached.version, entry: cached };
  const generation = state.generation;
  const stored = await load();
  const entry = {
    fingerprint,
    generation,
    loadedAt: Date.now(),
    stored,
    version: `${fingerprint}:${generation}:${Date.now()}`,
    byFilter: new Map(),
  };
  // A write that happened while loading makes this copy stale: don't keep it.
  if (generation === state.generation) state.corpora.set(namespace, entry);
  return { stored, version: entry.version, entry };
}

/**
 * The filtered corpus array for a filter key. The same array object is
 * returned for the same corpus version so BM25 can reuse its token index.
 */
function corpusDocumentsFor(corpus, filterKey, build) {
  if (!corpus?.entry) return build(corpus.stored);
  if (!corpus.entry.byFilter.has(filterKey))
    corpus.entry.byFilter.set(filterKey, build(corpus.stored));
  return corpus.entry.byFilter.get(filterKey);
}

async function embedWithCache(LLMConnector, text) {
  const model =
    LLMConnector?.embedder?.model ||
    LLMConnector?.embedder?.className ||
    LLMConnector?.className ||
    "embedder";
  const dims = process.env.EMBEDDING_OUTPUT_DIMENSIONS || "";
  const key = `${model}|${dims}|${text}`;
  if (enabled() && state.embeddings.has(key)) {
    const vector = state.embeddings.get(key);
    remember(state.embeddings, key, vector, MAX_EMBEDDING_ENTRIES);
    return [...vector];
  }
  const vector = await LLMConnector.embedTextInput(text);
  if (enabled() && Array.isArray(vector) && vector.length > 0)
    remember(state.embeddings, key, [...vector], MAX_EMBEDDING_ENTRIES);
  return vector;
}

function searchKey(parts) {
  return crypto.createHash("sha1").update(JSON.stringify(parts)).digest("hex");
}

function getSearch(key) {
  if (!enabled()) return null;
  const hit = state.searches.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > SEARCH_TTL_MS) {
    state.searches.delete(key);
    return null;
  }
  return structuredClone(hit.value);
}

function setSearch(key, value) {
  if (!enabled()) return;
  remember(
    state.searches,
    key,
    { at: Date.now(), value: structuredClone(value) },
    MAX_SEARCH_ENTRIES
  );
}

module.exports = {
  enabled,
  invalidate,
  loadCorpus,
  corpusDocumentsFor,
  embedWithCache,
  searchKey,
  getSearch,
  setSearch,
  _state: state,
  CORPUS_TTL_MS,
};
