const test = require("node:test");
const assert = require("node:assert/strict");
const { modelFor, modelSummary } = require("../../utils/schatModels");

test("퀴즈·동의어·그림 설명은 따로 정하지 않으면 답변 모델을 따른다", () => {
  const env = { GEMINI_LLM_MODEL_PREF: "gemini-3.5-flash-lite" };
  assert.equal(modelFor("answer", env), "gemini-3.5-flash-lite");
  assert.equal(modelFor("quiz", env), "gemini-3.5-flash-lite");
  assert.equal(modelFor("synonym", env), "gemini-3.5-flash-lite");
  assert.equal(modelFor("imageDescription", env), "gemini-3.5-flash-lite");
});

test("용도별로 정한 모델을 쓰고, 잘못된 이름은 무시한다", () => {
  const env = {
    GEMINI_LLM_MODEL_PREF: "gemini-3.5-flash-lite",
    SCHAT_QUIZ_MODEL: "gemini-3.8-flash",
    SCHAT_SYNONYM_MODEL: "gpt-4o",
    SCHAT_PDF_IMAGE_DESCRIPTION_MODEL: "gemini-3.8-flash",
  };
  assert.equal(modelFor("quiz", env), "gemini-3.8-flash");
  assert.equal(modelFor("synonym", env), "gemini-3.5-flash-lite");
  assert.equal(modelFor("imageDescription", env), "gemini-3.8-flash");
});

test("검색 Embedding은 답변 모델을 따르지 않는다", () => {
  assert.equal(modelFor("embedding", { GEMINI_LLM_MODEL_PREF: "gemini-3.5-flash" }), "gemini-embedding-2");
});

test("관리자 표시용 요약은 모델 이름과 답변 모델을 따르는지만 담는다", () => {
  const summary = modelSummary({
    GEMINI_LLM_MODEL_PREF: "gemini-3.1-flash-lite",
    SCHAT_PDF_IMAGE_DESCRIPTION_MODEL: "gemini-3.8-flash",
    GEMINI_API_KEY: "secret-key",
  });
  const byPurpose = Object.fromEntries(summary.map((row) => [row.purpose, row]));
  assert.equal(byPurpose.quiz.followsAnswer, true);
  assert.equal(byPurpose.imageDescription.followsAnswer, false);
  assert.equal(byPurpose.imageDescription.model, "gemini-3.8-flash");
  assert.doesNotMatch(JSON.stringify(summary), /secret-key/);
  assert.throws(() => modelFor("unknown", {}));
});
