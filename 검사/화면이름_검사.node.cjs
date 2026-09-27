const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const read = (relativePath) =>
  fs.readFileSync(path.join(ROOT, relativePath), "utf8");

test("브라우저와 설치 화면의 기본 이름은 SCHAT이다", () => {
  const html = read("frontend/index.html");
  const manifest = JSON.parse(read("frontend/public/manifest.json"));
  assert.match(html, /<title>병원 실무지침 AI<\/title>/);
  assert.equal(manifest.name, "병원 실무지침 AI");
  assert.equal(manifest.short_name, "SCHAT");
});

test("로그인 화면은 병원 직원 전용 안내를 표시한다", () => {
  const login = read("frontend/src/components/Modals/Password/index.jsx");
  assert.match(login, /순천향대학교 부속 천안병원/);
  assert.match(login, /직원 전용/);
  assert.match(login, /병원 실무지침 AI/);
});

test("알림 기본 이름에 원래 제품명을 노출하지 않는다", () => {
  const worker = read("frontend/public/service-workers/push-notifications.js");
  assert.doesNotMatch(worker, /AnythingLLM/i);
  assert.match(worker, /병원 실무지침 AI/);
});

test("설정 화면은 Gemini Embedding 2와 ChromaDB만 보여준다", () => {
  const embedding = read(
    "frontend/src/pages/GeneralSettings/EmbeddingPreference/index.jsx"
  );
  const vectorDb = read(
    "frontend/src/pages/GeneralSettings/VectorDatabase/index.jsx"
  );
  assert.match(embedding, /Gemini Embedding 2/);
  assert.doesNotMatch(embedding, /NativeEmbeddingOptions/);
  assert.match(vectorDb, /SCHAT ChromaDB/);
  assert.doesNotMatch(vectorDb, /LanceDBOptions/);
});
