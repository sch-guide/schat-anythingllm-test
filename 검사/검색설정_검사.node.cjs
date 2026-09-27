const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const read = (relativePath) =>
  fs.readFileSync(path.join(ROOT, relativePath), "utf8");

test("문서 검색 임베딩은 Gemini만 허용하고 MiniLM으로 대체하지 않는다", () => {
  const helper = read("server/utils/helpers/index.js");
  const selector = helper
    .split("function getEmbeddingEngineSelection()", 2)[1]
    .split("function getImageGeneratorProvider()", 1)[0];
  assert.doesNotMatch(selector, /NativeEmbedder/);
  assert.match(selector, /engineSelection !== "gemini"/);

  const geminiLlm = read("server/utils/AiProviders/gemini/index.js");
  assert.doesNotMatch(geminiLlm, /NativeEmbedder/);
  assert.match(geminiLlm, /GeminiEmbedder/);

  const geminiEmbedder = read("server/utils/EmbeddingEngines/gemini/index.js");
  assert.match(
    geminiEmbedder,
    /GEMINI_EMBEDDING_API_KEY \|\| process\.env\.GEMINI_API_KEY/
  );
});

test("문서 검색 벡터 저장소는 ChromaDB로 고정한다", () => {
  const helper = read("server/utils/helpers/index.js");
  const selector = helper
    .split("function getVectorDbClass", 2)[1]
    .split("function getLLMProvider", 1)[0];
  assert.match(selector, /vectorSelection !== "chroma"/);
  assert.match(selector, /require\("\.\.\/vectorDbProviders\/chroma"\)/);
});

test("답변 생성은 기존 Gemini 키를 Gemini LLM provider에 전달한다", () => {
  const compose = read("docker/docker-compose.yml");
  assert.match(compose, /LLM_PROVIDER:\s*gemini/);
  assert.match(compose, /GEMINI_LLM_MODEL_PREF:\s*gemini-3\.8-flash/);
  assert.match(
    compose,
    /GEMINI_API_KEY:\s*\$\{GEMINI_EMBEDDING_API_KEY\}/
  );
});

test("실행 예시는 Gemini Embedding 2와 ChromaDB를 사용한다", () => {
  for (const relativePath of ["server/.env.example", "docker/.env.example"]) {
    const envText = read(relativePath);
    assert.match(envText, /EMBEDDING_ENGINE="gemini"/);
    assert.match(envText, /EMBEDDING_MODEL_PREF="gemini-embedding-2"/);
    assert.match(envText, /VECTOR_DB="chroma"/);
    assert.doesNotMatch(envText, /all-MiniLM/);

    const activeVectorDbSettings = envText
      .split(/\r?\n/)
      .filter((line) => /^\s*VECTOR_DB\s*=/.test(line));
    assert.deepEqual(activeVectorDbSettings, ['VECTOR_DB="chroma"']);
  }
});
