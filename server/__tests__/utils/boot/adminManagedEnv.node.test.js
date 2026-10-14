const test = require("node:test");
const assert = require("node:assert/strict");
const { applyAdminManagedEnv } = require("../../../utils/boot/adminManagedEnv");

const file = (text) => ({ envPath: "/fake/.env", readFile: () => text });

test("재시작 때 관리자 화면에서 저장한 답변 모델이 컨테이너의 예전 값보다 우선한다", () => {
  const env = { GEMINI_LLM_MODEL_PREF: "gemini-3.1-flash-lite", VECTOR_DB: "chroma" };
  const changed = applyAdminManagedEnv({
    env,
    ...file("GEMINI_LLM_MODEL_PREF='gemini-3.5-flash-lite'\nVECTOR_DB='lancedb'\n"),
  });
  assert.deepEqual(changed, ["GEMINI_LLM_MODEL_PREF"]);
  assert.equal(env.GEMINI_LLM_MODEL_PREF, "gemini-3.5-flash-lite");
  // 관리자 화면이 다루지 않는 값은 컨테이너 설정을 그대로 따른다.
  assert.equal(env.VECTOR_DB, "chroma");
});

test("API 키도 관리자 화면 값을 따르고, 바뀐 항목 이름만 알린다", () => {
  const env = { GEMINI_API_KEY: "old-key", GEMINI_EMBEDDING_API_KEY: "embed-key" };
  const changed = applyAdminManagedEnv({
    env,
    ...file("GEMINI_API_KEY=new-key\nGEMINI_EMBEDDING_API_KEY=embed-key\n"),
  });
  assert.deepEqual(changed, ["GEMINI_API_KEY"]);
  assert.equal(env.GEMINI_API_KEY, "new-key");
  assert.doesNotMatch(JSON.stringify(changed), /new-key/);
});

test("파일이 없거나 값이 이상하면 기존 값을 그대로 둔다", () => {
  const env = { GEMINI_LLM_MODEL_PREF: "gemini-3.8-flash" };
  assert.deepEqual(applyAdminManagedEnv({ env, envPath: "/x", readFile: () => { throw new Error("ENOENT"); } }), []);
  assert.deepEqual(applyAdminManagedEnv({ env, ...file("GEMINI_LLM_MODEL_PREF='gpt-4o'\n") }), []);
  assert.deepEqual(applyAdminManagedEnv({ env, ...file("GEMINI_LLM_MODEL_PREF=''\n") }), []);
  assert.equal(env.GEMINI_LLM_MODEL_PREF, "gemini-3.8-flash");
});
