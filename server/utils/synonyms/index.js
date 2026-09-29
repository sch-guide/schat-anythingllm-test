// SCHAT 동의어 사전.
// - 같은 뜻의 단어 묶음(예: 카테터 = cath = catheter)을 관리자가 관리한다.
// - status "active" 묶음만 검색(BM25 단어 일치)과 체크리스트 연결에 쓴다.
// - Gemini 호출 없이 문자열로만 넓힌다.
// - 삽입 계열과 제거 계열처럼 서로 다른 시술 동작은 한 묶음에 넣을 수 없다.
// - 초안에는 약물을 넣지 않는다. 약물(kind "drug")은 관리자가 넣은 것만 있다.

const SYNONYM_KINDS = Object.freeze(["procedure", "drug"]);
const SYNONYM_STATUSES = Object.freeze(["needs_review", "active", "off"]);
const DRAFTS_SEEDED_LABEL = "schat_synonym_drafts_seeded";
const ACTIVE_CACHE_TTL_MS = 30 * 1000;

// Opposite procedure actions. A group may not mix words of both lists, and a
// checklist found only through an everyday/synonym name is not shown for the
// opposite action (see checklist matching).
const ACTION_WORDS = Object.freeze({
  insert: ["삽입", "거치", "설치", "insertion", "insert"],
  remove: ["제거", "발거", "remove", "removal"],
});

// 초안: "검사 및 시술"·실무지침서에 자주 나오는 시술·기구 이름의 한글/영문/약어
// 표기. 모두 "검토 필요"로 들어가며 관리자가 켜야 적용된다. 약물 없음.
const DRAFT_GROUPS = Object.freeze([
  ["카테터", "cath", "catheter"],
  ["HD", "혈액투석", "hemodialysis"],
  ["복막투석", "CAPD", "peritoneal dialysis"],
  ["생검", "조직검사", "biopsy"],
  ["기관지내시경", "bronchoscopy", "BFS"],
  ["위내시경", "gastroscopy", "GFS", "EGD"],
  ["대장내시경", "colonoscopy", "CFS"],
  ["흉수천자", "흉강천자", "thoracentesis"],
  ["복수천자", "paracentesis"],
  ["요추천자", "척추천자", "spinal tapping"],
  ["심낭천자", "심장천자", "pericardiocentesis"],
  ["흉관", "chest tube"],
  ["위루술", "PEG", "gastrostomy"],
  ["신루", "신루관", "nephrostomy"],
  ["스텐트", "stent"],
  ["혈관조영술", "angiography", "angio"],
  ["심박동기", "pacemaker"],
  ["제세동기", "defibrillator"],
  ["심전도", "EKG", "ECG"],
  ["유치도뇨관", "foley"],
  ["중심정맥관", "central line", "CVC"],
  ["드레싱", "dressing"],
  ["수혈", "transfusion"],
]);

function cleanTerm(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(/\s+/g, " ")
    .trim();
}

function termKey(value) {
  return cleanTerm(value).toLowerCase().replace(/\s+/g, "");
}

function actionOf(text = "") {
  const lower = String(text).normalize("NFKC").toLowerCase();
  const found = new Set();
  for (const [action, words] of Object.entries(ACTION_WORDS))
    if (words.some((word) => lower.includes(word))) found.add(action);
  return found;
}

/**
 * Validates a group from the admin screen. Returns a clean definition or
 * throws a Korean message that can be shown to the administrator.
 */
function validateSynonymGroup(input = {}) {
  const raw = Array.isArray(input.terms)
    ? input.terms
    : String(input.terms ?? "").split(/[,=\n]/);
  const terms = [];
  const seen = new Set();
  for (const value of raw) {
    const term = cleanTerm(value);
    if (!term) continue;
    if (term.length > 40) throw new Error("단어는 40자 이하로 입력해 주세요.");
    const key = termKey(term);
    if (seen.has(key)) continue;
    seen.add(key);
    terms.push(term);
  }
  if (terms.length < 2)
    throw new Error("같은 뜻의 단어를 2개 이상 입력해 주세요.");
  if (terms.length > 20)
    throw new Error("한 묶음에는 20개까지 넣을 수 있습니다.");
  const actions = new Set(terms.flatMap((term) => [...actionOf(term)]));
  if (actions.size > 1)
    throw new Error(
      "삽입과 제거처럼 서로 다른 시술 동작은 한 묶음에 넣을 수 없습니다."
    );
  const kind = SYNONYM_KINDS.includes(input.kind) ? input.kind : "procedure";
  const status = SYNONYM_STATUSES.includes(input.status)
    ? input.status
    : "active";
  const note = cleanTerm(input.note).slice(0, 200) || null;
  return { terms, kind, status, note };
}

function parseTerms(value) {
  try {
    const terms = JSON.parse(value);
    return Array.isArray(terms) ? terms.map(cleanTerm).filter(Boolean) : [];
  } catch {
    return [];
  }
}

function toPublicGroup(row = {}) {
  return {
    id: row.id,
    terms: parseTerms(row.terms),
    kind: row.kind,
    status: row.status,
    source: row.source,
    note: row.note || "",
    updatedAt: row.lastUpdatedAt,
  };
}

// ---- storage (Prisma) -------------------------------------------------------

let activeCache = null;
let version = 0;

function invalidate() {
  activeCache = null;
  version += 1;
}

function prismaClient() {
  return require("../prisma");
}

async function ensureDraftGroups(prisma = prismaClient()) {
  const seeded = await prisma.system_settings.findUnique({
    where: { label: DRAFTS_SEEDED_LABEL },
  });
  if (seeded) return false;
  await prisma.$transaction([
    ...DRAFT_GROUPS.map((terms) =>
      prisma.schat_synonym_groups.create({
        data: {
          terms: JSON.stringify(terms),
          kind: "procedure",
          status: "needs_review",
          source: "draft",
        },
      })
    ),
    prisma.system_settings.create({
      data: { label: DRAFTS_SEEDED_LABEL, value: new Date().toISOString() },
    }),
  ]);
  invalidate();
  return true;
}

async function listGroups(prisma = prismaClient()) {
  await ensureDraftGroups(prisma);
  const rows = await prisma.schat_synonym_groups.findMany({
    orderBy: [{ id: "asc" }],
  });
  return rows.map(toPublicGroup);
}

async function createGroup(input, prisma = prismaClient()) {
  const group = validateSynonymGroup(input);
  const row = await prisma.schat_synonym_groups.create({
    data: {
      terms: JSON.stringify(group.terms),
      kind: group.kind,
      status: group.status,
      source: "admin",
      note: group.note,
    },
  });
  invalidate();
  return toPublicGroup(row);
}

async function updateGroup(id, input, prisma = prismaClient()) {
  const existing = await prisma.schat_synonym_groups.findUnique({
    where: { id: Number(id) },
  });
  if (!existing) return null;
  const group = validateSynonymGroup({
    terms: input.terms ?? parseTerms(existing.terms),
    kind: input.kind ?? existing.kind,
    status: input.status ?? existing.status,
    note: input.note ?? existing.note,
  });
  const row = await prisma.schat_synonym_groups.update({
    where: { id: existing.id },
    data: {
      terms: JSON.stringify(group.terms),
      kind: group.kind,
      status: group.status,
      note: group.note,
      lastUpdatedAt: new Date(),
    },
  });
  invalidate();
  return toPublicGroup(row);
}

async function deleteGroup(id, prisma = prismaClient()) {
  const existing = await prisma.schat_synonym_groups.findUnique({
    where: { id: Number(id) },
  });
  if (!existing) return false;
  await prisma.schat_synonym_groups.delete({ where: { id: existing.id } });
  invalidate();
  return true;
}

/**
 * Active groups only ({ terms }), cached briefly. Never throws: without the
 * table (or on any error) the search simply runs without synonyms.
 */
async function getActiveGroups(prisma = null) {
  if (activeCache && Date.now() - activeCache.at < ACTIVE_CACHE_TTL_MS)
    return activeCache.groups;
  try {
    const client = prisma || prismaClient();
    const rows = await client.schat_synonym_groups.findMany({
      where: { status: "active" },
      orderBy: [{ id: "asc" }],
    });
    const groups = rows
      .map((row) => ({ id: row.id, terms: parseTerms(row.terms) }))
      .filter((group) => group.terms.length >= 2);
    activeCache = { at: Date.now(), groups };
    return groups;
  } catch {
    return [];
  }
}

function synonymsVersion() {
  const ids = (activeCache?.groups || []).map((group) => group.id).join(",");
  return `${version}:${ids}`;
}

// ---- expansion --------------------------------------------------------------

/**
 * For BM25: maps each single-word query term to its alternatives (the term
 * itself first). Multi-word synonyms are used only for checklist names.
 * `normalize` must turn a word into the same token form BM25 uses.
 */
function termAlternatives(terms = [], groups = [], normalize = termKey) {
  const alternatives = new Map();
  for (const term of terms) {
    const list = [term];
    for (const group of groups) {
      const keys = group.terms.map(normalize);
      if (!keys.includes(normalize(term))) continue;
      for (const candidate of keys)
        if (candidate && !/\s/.test(candidate) && !list.includes(candidate))
          list.push(candidate);
    }
    alternatives.set(term, list);
  }
  return alternatives;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// A term occurs in a name: English words as whole words, Korean as text
// (Korean names are often written without spaces, e.g. "투석관삽입술").
function termPattern(term) {
  const clean = cleanTerm(term);
  if (/^[0-9A-Za-z .\-]+$/.test(clean))
    return new RegExp(
      `(^|[^0-9A-Za-z])${escapeRegExp(clean)}(?=$|[^0-9A-Za-z])`,
      "giu"
    );
  return clean.length >= 2 ? new RegExp(escapeRegExp(clean), "gu") : null;
}

/**
 * Checklist names with one synonym swapped in, e.g. "HD 카테터" ->
 * "HD cath", "HD catheter". Capped so a checklist never gets a huge list.
 */
function synonymNameVariants(names = [], groups = [], limit = 40) {
  const own = new Set(names.map(termKey));
  const result = [];
  for (const name of names) {
    for (const group of groups) {
      for (const term of group.terms) {
        const pattern = termPattern(term);
        if (!pattern || !pattern.test(name)) continue;
        for (const other of group.terms) {
          if (termKey(other) === termKey(term)) continue;
          pattern.lastIndex = 0;
          const variant = name.replace(pattern, (match, lead = "") =>
            typeof lead === "string" && /^[0-9A-Za-z]/.test(term)
              ? `${lead}${other}`
              : other
          );
          const key = termKey(variant);
          if (own.has(key)) continue;
          own.add(key);
          result.push(variant);
          if (result.length >= limit) return result;
        }
      }
    }
  }
  return result;
}

module.exports = {
  ACTION_WORDS,
  DRAFT_GROUPS,
  SYNONYM_KINDS,
  SYNONYM_STATUSES,
  actionOf,
  validateSynonymGroup,
  toPublicGroup,
  ensureDraftGroups,
  listGroups,
  createGroup,
  updateGroup,
  deleteGroup,
  getActiveGroups,
  invalidate,
  synonymsVersion,
  termAlternatives,
  synonymNameVariants,
};
