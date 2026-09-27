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
  return Boolean(detectQuestionIntent(question) || queryTokens(question).length);
}

module.exports = { shouldForceHospitalRagSearch };
