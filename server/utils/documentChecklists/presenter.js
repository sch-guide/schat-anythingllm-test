const { pdfRefForDocumentId } = require("../originalDocuments");
const { searchAliasesFor } = require("./commonNames");
const { synonymNameVariants } = require("../synonyms");
const { checklistDocumentKind } = require("./versionMatch");
const { checklistTemplateKind } = require("./procedureExtractor");

// 자료 분류(검사 및 시술 / 수술 / 기타). The automatic classification below
// is kept for every new checklist; an administrator can override it per
// checklist (adminKind), and that choice wins on the administrator screen.
const CHECKLIST_KINDS = Object.freeze(["procedure", "surgery", "other"]);

function validAdminKind(value) {
  return CHECKLIST_KINDS.includes(value) ? value : null;
}

function checklistDisplayKind(checklist = {}) {
  return validAdminKind(checklist.adminKind) || checklistAutoKind(checklist);
}

function checklistAutoKind(checklist = {}) {
  const formKind = checklistTemplateKind(checklist);
  if (formKind === "surgery") return "surgery";

  // Some pages in the surgery handbook use the ordinary 검사 전/후 form.
  // The handbook type is only a fallback for those pages; a surgery-shaped
  // form above always wins even inside a mixed 검사 및 시술 handbook.
  const handbookKind = checklistDocumentKind(checklist.source?.filename || "");
  if (handbookKind === "surgery") return "surgery";
  const names = [
    checklist.title,
    ...(Array.isArray(checklist.aliases) ? checklist.aliases : []),
  ];
  if (
    names.some((name) =>
      /^(?:3|three)positionbp$/u.test(
        String(name || "").normalize("NFKC").toLowerCase().replace(/[\s-]+/gu, "")
      )
    )
  ) return "procedure";
  return formKind || "other";
}

// 예전 추출에서 한 쪽의 두 양식이 합쳐지며 본문 글자("Prepare", "수술실/S-car",
// "금식여부 MN NPO …")가 이름에 들어간 체크리스트가 있다 (2026-10-15).
// 이런 이름은 질문의 흔한 낱말에 걸려 엉뚱한 체크리스트를 띄우므로 직원 화면에서는 뺀다.
// 저장된 내용과 관리자 화면은 그대로 둔다.
const FORM_TEXT =
  /금식여부|ivline|prepare|opgown|s-?car|이동수단|(?:검사|수술|시술)전준비|예방적항생제|npo|수술실|동의서|관찰사항|x-?ray및lab|표시$|시행$|착용$/u;

function isFormTextAlias(name) {
  return FORM_TEXT.test(String(name || "").normalize("NFKC").toLowerCase().replace(/\s+/gu, ""));
}

function searchNames(checklist, synonymGroups = [], sourceNames = []) {
  const aliases = Array.isArray(checklist.aliases) ? checklist.aliases : [];
  // 원문 쪽의 수술명·시술명·병명(sourceNames.js). 저장된 이름에 없는 것만 더한다.
  const own = new Set(aliases.map((name) => String(name).normalize("NFKC").toLowerCase().replace(/\s+/g, "")));
  const fromSource = (Array.isArray(sourceNames) ? sourceNames : []).filter(
    (name) => !own.has(String(name).normalize("NFKC").toLowerCase().replace(/\s+/g, ""))
  );
  const everyday = [...searchAliasesFor(checklist), ...fromSource];
  // Active synonyms (동의어 사전): the same names with one word swapped.
  return [
    ...everyday,
    ...synonymNameVariants([...aliases, ...everyday], synonymGroups),
  ];
}

// How a checklist of a newly uploaded edition compares with the earlier one.
const VERSION_REVIEW_CODES = new Set([
  "changed",
  "new",
  "ambiguous",
  "previous-not-public",
  "previous-unverifiable",
]);

function versionResult(checklist = {}) {
  const value = checklist.versionMatch?.result;
  return typeof value === "string" && /^[a-z-]+$/u.test(value) ? value : null;
}

function reviewReasons(checklist = {}) {
  const codes = Array.isArray(checklist.validation?.problems)
    ? checklist.validation.problems.filter((code) => /^[a-z-]+$/u.test(code))
    : [];
  const version = versionResult(checklist);
  if (checklist.status === "needs_review" && VERSION_REVIEW_CODES.has(version))
    codes.push(`version-${version}`);
  // A new automatic checklist that passed the source comparison still waits
  // for an administrator.
  if (
    !codes.length &&
    checklist.status === "needs_review" &&
    checklist.autoVerified
  )
    return ["auto-generated"];
  return codes;
}

function toPublicChecklist(
  checklist,
  {
    originalStorageRoot,
    synonymGroups = [],
    sourceNames = [],
    sourceTitle = "",
    hideFormTextAliases = false,
  } = {}
) {
  if (!checklist) return null;
  const stored = Array.isArray(checklist.aliases) ? checklist.aliases : [];
  const aliases = hideFormTextAliases
    ? stored.filter((name) => !isFormTextAlias(name))
    : stored;
  return {
    id: checklist.id,
    title: hideFormTextAliases && sourceTitle ? sourceTitle : checklist.title,
    aliases,
    // Extra everyday names used only to find the checklist from a question.
    searchAliases: searchNames({ ...checklist, aliases }, synonymGroups, sourceNames),
    sections: Array.isArray(checklist.sections) ? checklist.sections : [],
    active: checklist.status === "active" && checklist.active !== false,
    status: ["needs_review", "hidden"].includes(checklist.status)
      ? checklist.status
      : "active",
    // Drafts written from non-standard pages carry a note for the reviewer.
    draft: checklist.draft === true,
    reviewNote:
      typeof checklist.reviewNote === "string"
        ? checklist.reviewNote.slice(0, 500)
        : "",
    reviewReasons: reviewReasons(checklist),
    // "same" = published automatically because the new edition is identical.
    versionMatch: versionResult(checklist),
    autoPublished: checklist.autoPublished === true,
    autoGenerated: checklist.autoGenerated === true,
    editedByAdmin: checklist.editedByAdmin === true,
    source: {
      filename: checklist.source?.filename || "",
      page: Number(checklist.source?.page || checklist.page || 0) || null,
      kind: checklistDisplayKind(checklist),
      // What the program decided, and the administrator's choice (or null).
      autoKind: checklistAutoKind(checklist),
      adminKind: validAdminKind(checklist.adminKind),
      pdfRef: pdfRefForDocumentId(String(checklist.documentId || ""), {
        storageRoot: originalStorageRoot,
      }),
    },
  };
}

module.exports = {
  CHECKLIST_KINDS,
  validAdminKind,
  checklistAutoKind,
  checklistDisplayKind,
  toPublicChecklist,
  isFormTextAlias,
};
