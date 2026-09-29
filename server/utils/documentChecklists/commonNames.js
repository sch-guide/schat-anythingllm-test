// Everyday names staff use for the procedures in the "검사 및 시술" handbook,
// so a question such as "폐생검 후 간호" opens the PTNB checklist.
//
// - Each entry is keyed by a name the checklist already has (its alias), so
//   the table keeps working when page numbers change.
// - The names are only used to FIND a checklist (searchAliases). The
//   checklist content, its own aliases and the Citation filter are unchanged.
// - Ambiguous words are deliberately left out: "EMR" (전자의무기록),
//   "LP", "pacemaker" (temporary pacemakers too), "피크" (peak level) ...
const COMMON_NAMES = Object.freeze([
  {
    key: "Chemoport insertion",
    names: ["케모포트", "chemoport", "케모포트 삽입"],
  },
  { key: "PICC", names: ["말초삽입 중심정맥관", "말초삽입형 중심정맥관"] },
  { key: "BM Bx", names: ["골수 생검", "골수천자", "BM biopsy"] },
  { key: "IT CTx", names: ["IT 항암", "척수강내 항암"] },
  { key: "Spinal tapping", names: ["척추천자", "spinal tap", "허리천자"] },
  { key: "PSG", names: ["수면검사"] },
  { key: "BFS", names: ["bronchoscopy"] },
  {
    key: "PTNB",
    names: [
      "경피적 폐생검",
      "폐생검",
      "폐 조직검사",
      "폐 세침검사",
      "lung biopsy",
    ],
  },
  { key: "BAE", names: ["기관지동맥색전술"] },
  { key: "Thoracentesis", names: ["흉강천자"] },
  { key: "D-J Stent insert", names: ["요관 스텐트", "요관부목"] },
  { key: "RGP", names: ["신우조영술"] },
  { key: "RGU", names: ["요도조영술", "역행성 요도조영술"] },
  { key: "VCUG", names: ["방광요도조영술"] },
  { key: "Cystoscopy", names: ["방광경", "방광 내시경"] },
  { key: "Prostate Biopsy", names: ["전립선 조직검사"] },
  { key: "SSNHL", names: ["돌발성 난청"] },
  { key: "GFS", names: ["상부내시경", "EGD", "gastroscopy"] },
  { key: "G-ESD", names: ["위 ESD", "위 EMR"] },
  { key: "C-ESD", names: ["대장 ESD", "대장 EMR"] },
  { key: "캡슐내시경", names: ["capsule endoscopy"] },
  { key: "UBT", names: ["호기검사", "요소 호기검사"] },
  { key: "PCD", names: ["경피적 카테터 배액술"] },
  { key: "ERCP", names: ["역행성 담췌관 조영술"] },
  { key: "RGC", names: ["역행성 담도조영술"] },
  {
    key: "TACE",
    names: ["간동맥화학색전술", "경동맥화학색전술", "화학색전술"],
  },
  { key: "TIPS", names: ["간속문맥 전신순환지름술"] },
  { key: "Liver Biopsy", names: ["간생검", "간 조직검사"] },
  { key: "EVL", names: ["식도정맥류 결찰술"] },
  { key: "PTBD", names: ["경피적 담도배액술"] },
  { key: "UGI", names: ["상부위장관조영술"] },
  { key: "renal biopsy", names: ["신장생검", "kidney biopsy"] },
  { key: "Venogram", names: ["정맥조영술"] },
  {
    key: "Perm Catheter Insertion",
    names: ["perm catheter", "perm cath", "펌카테터", "펌카테터 삽입"],
  },
  { key: "Perm Catheter remove", names: ["펌카테터 제거", "perm cath remove"] },
  {
    key: "HD Catheter Insertion",
    names: ["HD 투석관 삽입술", "HD 카테터", "HD catheter"],
  },
  { key: "PCN", names: ["신루관", "경피적 신루설치술"] },
  { key: "TFCA", names: ["뇌혈관조영술"] },
  { key: "CAG", names: ["심혈관조영술", "관상동맥 중재술"] },
  { key: "PPM", names: ["영구 심박동기", "영구적 심박동기"] },
  { key: "Thrombectomy, Thrombolysis", names: ["혈전용해술"] },
  {
    key: "심장컴퓨터단층촬영",
    names: ["심장 CT", "관상동맥 CT", "calcium score"],
  },
  { key: "심장자기공명영상", names: ["심장 MRI", "heart MRI"] },
  { key: "Holter monitor", names: ["홀터", "holter", "24시간 심전도"] },
  { key: "Pericardiocentesis", names: ["심낭천자"] },
  { key: "ANS Test", names: ["tilt test", "head up tilt"] },
]);

function nameKey(value = "") {
  return String(value).normalize("NFKC").toLowerCase().replace(/\s+/g, "");
}

// "Thrombectomy, Thrombolysis" and "A / B" hold two names in one alias.
function splitAlias(alias = "") {
  const parts = String(alias)
    .split(/\s*[,/]\s*/u)
    .map((part) => part.trim())
    .filter((part) => part.length >= 2);
  return parts.length > 1 ? parts : [];
}

/**
 * Extra names used only to find this checklist from a question. Returns
 * names the checklist does not already have.
 */
function searchAliasesFor(checklist = {}) {
  const aliases = Array.isArray(checklist.aliases) ? checklist.aliases : [];
  const original = new Set(aliases.map(nameKey));
  const own = new Set(original);
  const result = [];
  const add = (name) => {
    const key = nameKey(name);
    if (!key || own.has(key)) return;
    own.add(key);
    result.push(name);
  };
  aliases.flatMap(splitAlias).forEach(add);
  for (const entry of COMMON_NAMES)
    if (original.has(nameKey(entry.key))) entry.names.forEach(add);
  return result;
}

module.exports = { COMMON_NAMES, searchAliasesFor, splitAlias };
