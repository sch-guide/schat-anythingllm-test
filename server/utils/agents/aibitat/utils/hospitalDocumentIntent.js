const {
  detectQuestionIntent,
  queryTokens,
} = require("../../../vectorDbProviders/chroma/schatBm25");

const HOSPITAL_DOCUMENT_ROOTS = [
  "병원",
  "의료",
  "임상",
  "간호",
  "환자",
  "지침",
  "매뉴얼",
  "교육",
  "약물",
  "투약",
  "약제",
  "검사",
  "검체",
  "시술",
  "수술",
  "수혈",
  "감염",
  "격리",
  "통증",
  "척도",
  "활력",
  "카테터",
  "혈액",
  "진정",
  "처치",
  "치료",
  "용량",
  "부작용",
];

function hasHospitalDocumentTerm(question = "") {
  return queryTokens(question).some((token) =>
    HOSPITAL_DOCUMENT_ROOTS.some((root) => token.includes(root))
  );
}

function hasClinicalAbbreviation(question = "") {
  const identifiers = String(question)
    .normalize("NFKC")
    .match(/\b[A-Z][A-Z0-9-]{2,9}\b/g);
  return Array.isArray(identifiers) && identifiers.length > 0;
}

function shouldForceHospitalRagSearch(question = "") {
  if (typeof question !== "string" || !question.trim()) return false;
  if (hasClinicalAbbreviation(question)) return true;
  if (!hasHospitalDocumentTerm(question)) return false;
  return Boolean(
    detectQuestionIntent(question) || queryTokens(question).length
  );
}

// Option A of the re-search comparison (default off): see aibitat/index.js.
function skipToolsAfterForcedSearch(env = process.env) {
  return (
    String(
      env.SCHAT_AGENT_SKIP_TOOLS_AFTER_FORCED_SEARCH || ""
    ).toLowerCase() === "true"
  );
}

// Option C (default off): SCHAT_AGENT_RESEARCH_MODE=bounded.
// - The forced hospital search is "sufficient" when it returned at least
//   3 different evidence chunks (decorative images such as the hospital logo
//   are not counted). Chunks on a single page count too: 3 of the 4 search
//   results on one page means that page is the dedicated section.
// - Otherwise at most BOUNDED_EXTRA_SEARCHES extra searches are allowed; any
//   further search request from the model is not executed.
const BOUNDED_EXTRA_SEARCHES = 2;
const SUFFICIENT_MIN_CHUNKS = 3;
const DECORATIVE_EVIDENCE = /로고|워터마크|엠블럼|logo|watermark|emblem/i;
const BOUNDED_FINAL_INSTRUCTION =
  "추가 검색은 더 할 수 없습니다. 지금까지 받은 병원 문서 근거로 지금 답하세요. 근거 중 질문과 관련된 내용이 일부라도 있으면 그 내용으로 답하고, 근거에 없는 부분만 '등록된 문서에서 확인되지 않습니다'라고 밝히세요. 질문과 관련된 근거가 하나도 없을 때만 '등록된 문서에서 확인되지 않습니다.'라고 답하세요. 근거에 없는 내용은 만들지 마세요.";
// Used only when the model keeps asking for searches after the limit. No
// clinical text is generated: the employee is pointed to the attached sources.
const BOUNDED_SOURCES_ONLY_ANSWER =
  "등록된 문서에서 관련 근거를 찾았습니다. 아래 출처에서 원문 내용을 확인해 주세요.";
const BOUNDED_NOT_FOUND_ANSWER = "등록된 문서에서 확인되지 않습니다.";

function boundedResearchEnabled(env = process.env) {
  return (
    String(env.SCHAT_AGENT_RESEARCH_MODE || "").toLowerCase() === "bounded"
  );
}

function forcedEvidenceIsSufficient(sources = []) {
  if (!Array.isArray(sources)) return false;
  const chunks = new Set();
  for (const source of sources) {
    if (!source || typeof source !== "object") continue;
    if (DECORATIVE_EVIDENCE.test(String(source.excerpt || source.text || "")))
      continue;
    const documentName =
      source.documentName || source.document_name || source.title || "";
    const page = source.page ?? "";
    chunks.add(
      source.id ||
        source.sourceId ||
        `${documentName}|${page}|${source.section || ""}|${String(source.excerpt || source.text || "").slice(0, 80)}`
    );
  }
  return chunks.size >= SUFFICIENT_MIN_CHUNKS;
}

module.exports = {
  shouldForceHospitalRagSearch,
  skipToolsAfterForcedSearch,
  boundedResearchEnabled,
  forcedEvidenceIsSufficient,
  BOUNDED_EXTRA_SEARCHES,
  BOUNDED_FINAL_INSTRUCTION,
  BOUNDED_SOURCES_ONLY_ANSWER,
  BOUNDED_NOT_FOUND_ANSWER,
};
