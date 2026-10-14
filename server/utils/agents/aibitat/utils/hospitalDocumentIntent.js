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
  "모니터링",
  // 2026-10-14: 이 단어들이 없어서 "중심정맥관 관리", "국소마취하 절개 및 배농"이
  // 문서 검색 없이 답변되던 문제 보완.
  "마취",
  "외과",
  "내과",
  "정맥",
  "동맥",
  "절개",
  "배농",
  "배액",
  "천자",
  "도뇨",
  "드레싱",
  "소독",
  "주사",
  "수액",
  "산소",
  "흡인",
  "상처",
  "욕창",
  "낙상",
  "혈압",
  "혈당",
];

// 전화번호부 질문("시설팀 전화번호 알려줘", "○○ 내선 번호")도 등록 문서에서
// 먼저 찾도록 함. 이런 질문에는 위 지침 용어가 없어 AI가 검색 없이 답하던 문제.
const CONTACT_ROOTS = ["전화", "번호", "내선", "연락처"];

const HOSPITAL_QUERY_ALIASES = [
  { pattern: /피\s*(?:를\s*)?넣기/u, replacement: "수혈" },
  // 존칭 "님"은 문서에 없음: "병원장님" → "병원장" (문서 검색어에서만)
  { pattern: /([가-힣]{2,})님(?=[\s?!.,]|$)/gu, replacement: "$1" },
];
const FOLLOW_UP_PATTERN = /(?:그중에서|그중|그거|그\s*다음|그\s*후)/u;

function applyHospitalQueryAliases(question = "") {
  return HOSPITAL_QUERY_ALIASES.reduce(
    (value, { pattern, replacement }) => value.replace(pattern, replacement),
    String(question).normalize("NFKC")
  );
}

function hasHospitalDocumentTerm(question = "") {
  return queryTokens(question).some(
    (token) =>
      HOSPITAL_DOCUMENT_ROOTS.some((root) => token.includes(root)) ||
      CONTACT_ROOTS.some((root) => token.includes(root))
  );
}

function hasClinicalAbbreviation(question = "") {
  const normalized = String(question).normalize("NFKC");
  const identifiers = normalized.match(/\b[A-Z][A-Z0-9-]{2,9}\b/g);
  if (Array.isArray(identifiers) && identifiers.length > 0) return true;
  // I&D, D&C처럼 &로 이은 약어
  return /(?<![A-Za-z0-9])[A-Za-z]\s*&\s*[A-Za-z](?![A-Za-z0-9])/.test(normalized);
}

// 한글 질문 안의 영어 의학 용어(local block, Foley 등). 간호사 질문의 영어 단어는
// 대부분 의학 용어라 먼저 문서를 찾는다. 인사말 같은 영어만 있으면 제외한다.
const NON_CLINICAL_LATIN = new Set([
  "hi",
  "hello",
  "hey",
  "okay",
  "thanks",
  "thank",
  "you",
  "test",
]);
function hasClinicalLatinTerm(question = "") {
  const words =
    String(question).normalize("NFKC").toLowerCase().match(/[a-z]{3,}/g) || [];
  return words.some((word) => !NON_CLINICAL_LATIN.has(word));
}

function shouldForceHospitalRagSearch(question = "") {
  if (typeof question !== "string" || !question.trim()) return false;
  const normalizedQuestion = applyHospitalQueryAliases(question);
  if (hasClinicalAbbreviation(normalizedQuestion)) return true;
  if (hasClinicalLatinTerm(normalizedQuestion)) return true;
  if (!hasHospitalDocumentTerm(normalizedQuestion)) return false;
  return Boolean(
    detectQuestionIntent(normalizedQuestion) || queryTokens(normalizedQuestion).length
  );
}

function previousClinicalTopic(chatHistory = [], currentQuestion = "") {
  if (!FOLLOW_UP_PATTERN.test(String(currentQuestion))) return "";
  let skippedCurrent = false;
  for (let index = chatHistory.length - 1; index >= 0; index -= 1) {
    const message = chatHistory[index];
    if (message?.role !== "user") continue;
    if (!skippedCurrent) {
      skippedCurrent = true;
      continue;
    }
    const normalized = applyHospitalQueryAliases(message.content || "");
    const topic = queryTokens(normalized).find((token) =>
      HOSPITAL_DOCUMENT_ROOTS.some((root) => token.includes(root))
    );
    if (topic) return topic;
  }
  return "";
}

function buildHospitalRetrievalQuery(question = "", chatHistory = []) {
  const normalized = applyHospitalQueryAliases(question).trim();
  const topic = previousClinicalTopic(chatHistory, normalized);
  if (!topic || normalized.includes(topic)) return normalized;
  return `${topic} ${normalized}`;
}

function isolateCurrentHospitalQuestion(messages = [], currentQuestion = "") {
  const system = messages.find((message) => message?.role === "system");
  return [
    ...(system ? [system] : []),
    { role: "user", content: currentQuestion },
  ];
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
  buildHospitalRetrievalQuery,
  isolateCurrentHospitalQuestion,
  skipToolsAfterForcedSearch,
  boundedResearchEnabled,
  forcedEvidenceIsSufficient,
  BOUNDED_EXTRA_SEARCHES,
  BOUNDED_FINAL_INSTRUCTION,
  BOUNDED_SOURCES_ONLY_ANSWER,
  BOUNDED_NOT_FOUND_ANSWER,
};
