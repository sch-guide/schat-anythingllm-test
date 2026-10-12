// SCHAT 개인정보 수집·이용 동의.
// - 동의서는 버전별로 쌓인다(지난 문구 보존). 가장 큰 버전이 현재 동의서.
// - 직원·관리자 모두 현재 버전에 한 번 동의해야 SCHAT 기능을 쓸 수 있다.
// - 동의 여부 확인은 요청마다 일어나므로 짧게 기억해 두고, 동의·게시 때 비운다.
const prisma = require("../prisma");
const { createHash } = require("node:crypto");
const {
  DEFAULT_CONSENT_CONTENT,
  CONSENT_ITEMS,
  LEGACY_V1_SEED_HASHES,
} = require("./defaultDocument");

const CACHE_MS = 30 * 1000;
let currentCache = null; // { at, document }
const userCache = new Map(); // userId -> { at, version, agreed }

function userError(message) {
  return Object.assign(new Error(message), { userFacing: true });
}

function versionLabel(version, date = new Date()) {
  // 한국 시간 기준 연·월
  const kst = new Date(date.getTime() + 9 * 60 * 60 * 1000);
  const month = String(kst.getUTCMonth() + 1).padStart(2, "0");
  return `v${version} · ${kst.getUTCFullYear()}.${month}`;
}

function present(row) {
  if (!row) return null;
  let content = {};
  try {
    content = JSON.parse(row.content || "{}");
  } catch {}
  return {
    version: row.version,
    label: row.label,
    publishedAt: row.published_at,
    content,
    items: CONSENT_ITEMS.map((item) => ({ ...item })),
  };
}

// 현재 동의서. 아직 하나도 없으면 v1 초안을 한 번만 넣는다.
async function currentDocument({ db = prisma, fresh = false } = {}) {
  if (
    !fresh &&
    db === prisma &&
    currentCache &&
    Date.now() - currentCache.at < CACHE_MS
  )
    return currentCache.document;
  let row = await db.schat_privacy_consent_documents.findFirst({
    orderBy: { version: "desc" },
  });
  if (!row) {
    try {
      row = await db.schat_privacy_consent_documents.create({
        data: {
          version: 1,
          label: versionLabel(1),
          content: JSON.stringify(DEFAULT_CONSENT_CONTENT),
        },
      });
    } catch {
      // 다른 요청이 먼저 v1을 넣은 경우
      row = await db.schat_privacy_consent_documents.findFirst({
        orderBy: { version: "desc" },
      });
    }
  }
  // 관리자가 고친 적 없는 예전 v1 초안이면 보완한 v1 문구로 바꾼다(버전·동의 기록 유지).
  if (
    row?.version === 1 &&
    row.published_by == null &&
    LEGACY_V1_SEED_HASHES.includes(
      createHash("sha256").update(String(row.content)).digest("hex")
    )
  )
    row = await db.schat_privacy_consent_documents.update({
      where: { id: row.id },
      data: { content: JSON.stringify(DEFAULT_CONSENT_CONTENT) },
    });
  const document = present(row);
  if (db === prisma) currentCache = { at: Date.now(), document };
  return document;
}

async function hasCurrentConsent(userId, { db = prisma } = {}) {
  const id = Number(userId);
  if (!Number.isSafeInteger(id) || id <= 0) return false;
  const { version } = await currentDocument({ db });
  const cached = userCache.get(id);
  if (
    db === prisma &&
    cached &&
    cached.version === version &&
    Date.now() - cached.at < CACHE_MS
  )
    return cached.agreed;
  const row = await db.schat_privacy_consents.findFirst({
    where: { user_id: id, version },
    select: { id: true },
  });
  const agreed = !!row;
  if (db === prisma) userCache.set(id, { at: Date.now(), version, agreed });
  return agreed;
}

// 3개 필수 항목이 모두 true이고, 동의한 버전이 지금 버전과 같아야 한다.
function validateAgreement(agreement, document) {
  if (!agreement || Number(agreement.version) !== document.version)
    throw userError(
      "동의서가 바뀌었습니다. 새 동의서를 확인한 뒤 다시 동의해 주세요."
    );
  const items = agreement.items || {};
  if (!CONSENT_ITEMS.every((item) => items[item.key] === true))
    throw userError("필수 항목에 모두 동의해야 SCHAT을 이용할 수 있습니다.");
  return Object.fromEntries(CONSENT_ITEMS.map((item) => [item.key, true]));
}

async function recordConsent(userId, agreement, { db = prisma } = {}) {
  const document = await currentDocument({ db, fresh: true });
  const items = validateAgreement(agreement, document);
  const id = Number(userId);
  const existing = await db.schat_privacy_consents.findFirst({
    where: { user_id: id, version: document.version },
  });
  const row =
    existing ||
    (await db.schat_privacy_consents.create({
      data: {
        user_id: id,
        version: document.version,
        items: JSON.stringify(items),
      },
    }));
  userCache.delete(id);
  return { version: row.version, agreedAt: row.agreed_at };
}

function cleanText(value, max) {
  return String(value ?? "")
    .replace(/\r\n/g, "\n")
    .trim()
    .slice(0, max);
}

// 관리자가 문구를 고치면 새 버전으로 게시한다. 모든 직원이 다시 동의한다.
async function publishDocument(adminId, input = {}, { db = prisma } = {}) {
  const content = {
    summary: {
      items: cleanText(input.summary?.items, 600),
      purpose: cleanText(input.summary?.purpose, 600),
      retention: cleanText(input.summary?.retention, 600),
      checklist: cleanText(input.summary?.checklist, 600),
      refusal: cleanText(input.summary?.refusal, 600),
    },
    external: {
      storage: cleanText(input.external?.storage, 300),
      generation: cleanText(input.external?.generation, 600),
    },
    fullText: cleanText(input.fullText, 20000),
  };
  if (
    Object.values(content.summary).some((v) => !v) ||
    Object.values(content.external).some((v) => !v) ||
    !content.fullText
  )
    throw userError("동의서의 모든 칸을 채워 주세요.");
  const current = await currentDocument({ db, fresh: true });
  if (Number(input.baseVersion) !== current.version)
    throw userError(
      "그사이 동의서가 바뀌었습니다. 새로 불러온 뒤 다시 고쳐 주세요."
    );
  if (JSON.stringify(content) === JSON.stringify(current.content))
    throw userError("바뀐 내용이 없습니다.");
  const version = current.version + 1;
  const row = await db.schat_privacy_consent_documents.create({
    data: {
      version,
      label: versionLabel(version),
      content: JSON.stringify(content),
      published_by: Number(adminId) || null,
    },
  });
  currentCache = null;
  userCache.clear();
  return present(row);
}

async function adminOverview({ db = prisma } = {}) {
  const document = await currentDocument({ db, fresh: true });
  const history = await db.schat_privacy_consent_documents.findMany({
    orderBy: { version: "desc" },
    select: { version: true, label: true, published_at: true },
  });
  const agreed = await db.schat_privacy_consents.count({
    where: { version: document.version },
  });
  const users = await db.users.count({ where: { suspended: 0 } });
  return {
    document,
    history: history.map((h) => ({
      version: h.version,
      label: h.label,
      publishedAt: h.published_at,
    })),
    agreedCurrent: agreed,
    activeUsers: users,
  };
}

async function historyDocument(version, { db = prisma } = {}) {
  const row = await db.schat_privacy_consent_documents.findUnique({
    where: { version: Number(version) },
  });
  if (!row) throw userError("동의서 버전을 찾을 수 없습니다.");
  return present(row);
}

// 사용자 관리 목록용: 직원별 가장 최근 동의(버전·날짜)와 현재 버전 동의 여부.
async function consentByUser(userIds = [], { db = prisma } = {}) {
  const document = await currentDocument({ db });
  const rows = await db.schat_privacy_consents.findMany({
    where: { user_id: { in: userIds } },
    orderBy: { version: "desc" },
  });
  const map = new Map();
  for (const row of rows)
    if (!map.has(row.user_id))
      map.set(row.user_id, {
        version: row.version,
        agreedAt: row.agreed_at,
        current: row.version === document.version,
      });
  return {
    currentVersion: document.version,
    currentLabel: document.label,
    map,
  };
}

// 동의 전에도 열려 있어야 하는 주소: 동의 화면, 로그인 확인, 내 정보.
const EXEMPT_PATHS = [
  /^\/schat\/privacy-consent(\/.*)?$/,
  /^\/system\/check-token$/,
  /^\/system\/refresh-user$/,
  /^\/schat\/me$/,
];
function exemptPath(path = "") {
  return EXEMPT_PATHS.some((pattern) => pattern.test(path));
}

function resetCaches() {
  currentCache = null;
  userCache.clear();
}

module.exports = {
  CONSENT_ITEMS,
  currentDocument,
  hasCurrentConsent,
  validateAgreement,
  recordConsent,
  publishDocument,
  adminOverview,
  historyDocument,
  consentByUser,
  exemptPath,
  versionLabel,
  resetCaches,
};
