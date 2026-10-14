// 관리자 화면(시스템 상태 → AI 설정)이 바꾸는 값은 서버를 다시 켜도 유지되어야 한다.
//
// Docker 컨테이너는 만들 때의 환경값을 그대로 들고 있고, dotenv는 이미 있는 값을
// 덮어쓰지 않는다. 그래서 관리자 화면이 .env를 고쳐도 재시작하면 컨테이너를 만들 때의
// 예전 모델·키로 돌아갔다(2026-10-14 재현). 관리자 화면이 저장하는 세 값만 .env를 우선한다.
// 다른 값(VECTOR_DB, CHROMA_ENDPOINT 등)은 지금처럼 컨테이너 설정을 따른다.
const fs = require("fs");
const path = require("path");

const ADMIN_MANAGED_KEYS = Object.freeze([
  "GEMINI_LLM_MODEL_PREF",
  "GEMINI_API_KEY",
  "GEMINI_EMBEDDING_API_KEY",
]);
const VALID = {
  GEMINI_LLM_MODEL_PREF: /^gemini-[a-zA-Z0-9._-]+$/u,
  GEMINI_API_KEY: /^[a-zA-Z0-9_-]{1,512}$/u,
  GEMINI_EMBEDDING_API_KEY: /^[a-zA-Z0-9_-]{1,512}$/u,
};

/**
 * .env의 관리자 관리 값을 process.env에 적용한다. 바뀐 항목 이름만 돌려준다(값은 돌려주지 않음).
 * 파일이 없거나 값이 올바르지 않으면 그 항목은 건드리지 않는다.
 */
function applyAdminManagedEnv({
  envPath = path.join(__dirname, "../../.env"),
  env = process.env,
  readFile = (file) => fs.readFileSync(file, "utf8"),
} = {}) {
  let parsed;
  try {
    parsed = require("dotenv").parse(readFile(envPath));
  } catch {
    return [];
  }
  const changed = [];
  for (const key of ADMIN_MANAGED_KEYS) {
    const value = typeof parsed[key] === "string" ? parsed[key].trim() : "";
    if (!value || !VALID[key].test(value) || env[key] === value) continue;
    env[key] = value;
    changed.push(key);
  }
  return changed;
}

module.exports = { applyAdminManagedEnv, ADMIN_MANAGED_KEYS };
