// SCHAT 용도별 Gemini 모델 설정 (2026-10-14).
// - 답변 모델(GEMINI_LLM_MODEL_PREF)은 관리자 화면 "AI 연결"에서 바꾼다.
// - 퀴즈·동의어 제안은 따로 정하지 않으면 답변 모델을 따른다.
// - PDF 그림 설명은 문서 등록(collector)에서 쓰며 .env에서만 바꾼다(재시작 필요).
// - 검색용 Embedding은 바꾸면 전체 재색인이 필요하므로 여기서 바꾸지 않는다.
const DEFAULT_ANSWER_MODEL = "gemini-2.0-flash-lite";
const MODEL_NAME = /^gemini-[a-zA-Z0-9._-]+$/u;

const PURPOSES = Object.freeze({
  answer: { envKey: "GEMINI_LLM_MODEL_PREF", label: "직원 답변" },
  // 환자 상황을 적고 판단을 묻는 질문, 답변 모델이 근거를 두고도 못 찾은 질문
  // (utils/agents/aibitat/utils/answerRoute.js). 생각 정도는 SCHAT_JUDGMENT_REASONING.
  judgment: {
    envKey: "SCHAT_JUDGMENT_MODEL",
    label: "판단 질문 답변",
    fixedDefault: "gemini-3.8-flash",
  },
  quiz: { envKey: "SCHAT_QUIZ_MODEL", label: "퀴즈 생성", followsAnswer: true },
  synonym: {
    envKey: "SCHAT_SYNONYM_MODEL",
    label: "동의어 후보 제안",
    followsAnswer: true,
  },
  imageDescription: {
    envKey: "SCHAT_PDF_IMAGE_DESCRIPTION_MODEL",
    label: "PDF 그림 설명(문서 등록)",
    followsAnswer: true,
  },
  embedding: {
    envKey: "EMBEDDING_MODEL_PREF",
    label: "검색 Embedding",
    fixedDefault: "gemini-embedding-2",
  },
});

function validModel(value) {
  return typeof value === "string" && MODEL_NAME.test(value.trim())
    ? value.trim()
    : null;
}

/** 용도에 쓸 모델 이름. 잘못된 값이면 답변 모델(또는 기본값)로 돌아간다. */
function modelFor(purpose = "answer", env = process.env) {
  const config = PURPOSES[purpose];
  if (!config) throw new Error(`Unknown SCHAT model purpose: ${purpose}`);
  const own = validModel(env[config.envKey]);
  if (own) return own;
  if (config.fixedDefault) return config.fixedDefault;
  if (config.followsAnswer) return modelFor("answer", env);
  return DEFAULT_ANSWER_MODEL;
}

/** 관리자 화면 표시용: 용도마다 모델과, 답변 모델을 따라가는지 여부. */
function modelSummary(env = process.env) {
  return Object.entries(PURPOSES).map(([purpose, config]) => ({
    purpose,
    label: config.label,
    model: modelFor(purpose, env),
    followsAnswer: !!config.followsAnswer && !validModel(env[config.envKey]),
    envKey: config.envKey,
  }));
}

module.exports = { PURPOSES, modelFor, modelSummary, DEFAULT_ANSWER_MODEL };
