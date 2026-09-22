const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const compose = fs.readFileSync(
  path.join(ROOT, "docker/docker-compose.yml"),
  "utf8"
);

test("웹 서버와 ChromaDB를 한 번에 실행한다", () => {
  assert.match(compose, /schat-web:/);
  assert.match(compose, /chroma:/);
  assert.match(compose, /chromadb\/chroma:/);
  assert.match(compose, /depends_on:/);
  assert.match(compose, /condition: service_healthy/);
});

test("Chroma 데이터는 재시작 후에도 보존한다", () => {
  assert.match(compose, /chroma_data:\/data/);
  assert.match(compose, /^volumes:\s*\n\s+chroma_data:/m);
});

test("Chroma 상태 검사는 이미지에 기본 포함된 명령만 사용한다", () => {
  assert.doesNotMatch(compose, /["']?curl["']?/);
  assert.match(compose, /timeout/);
  assert.match(compose, /bash/);
  assert.match(compose, /\/dev\/tcp\/127\.0\.0\.1\/8000/);
});

test("웹 서버는 같은 Docker 구성의 ChromaDB를 사용한다", () => {
  assert.match(compose, /CHROMA_ENDPOINT: http:\/\/chroma:8000/);
  assert.match(compose, /VECTOR_DB: chroma/);
  assert.match(compose, /EMBEDDING_ENGINE: gemini/);
  assert.match(compose, /EMBEDDING_MODEL_PREF: gemini-embedding-2/);
});
