const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

// 실제 DB 대신 이 검사 안의 가짜 표만 쓴다.
function load(relative, dependencies) {
  const filename = path.resolve(__dirname, "../../", relative);
  const module = { exports: {} };
  vm.runInNewContext(
    fs.readFileSync(filename, "utf8"),
    {
      module,
      exports: module.exports,
      console,
      Date,
      Map,
      Set,
      JSON,
      require: (name) =>
        name in dependencies
          ? dependencies[name]
          : require(require.resolve(name, { paths: [path.dirname(filename)] })),
    },
    { filename }
  );
  return module.exports;
}

function fakeDb() {
  const docs = [];
  const consents = [];
  const match = (row, where = {}) =>
    Object.entries(where).every(([k, v]) =>
      v && typeof v === "object" && "in" in v ? v.in.includes(row[k]) : row[k] === v
    );
  const db = {
    docs,
    consents,
    users: { count: async () => 3 },
    schat_privacy_consent_documents: {
      findFirst: async () => [...docs].sort((a, b) => b.version - a.version)[0] || null,
      findUnique: async ({ where }) => docs.find((d) => d.version === where.version) || null,
      findMany: async () => [...docs].sort((a, b) => b.version - a.version),
      update: async ({ where, data }) => Object.assign(docs.find((d) => d.id === where.id), data),
      create: async ({ data }) => {
        if (docs.some((d) => d.version === data.version)) throw new Error("unique");
        const row = { id: docs.length + 1, published_at: new Date("2026-10-12T03:00:00Z"), published_by: null, ...data };
        docs.push(row);
        return row;
      },
    },
    schat_privacy_consents: {
      findFirst: async ({ where }) => consents.find((c) => match(c, where)) || null,
      findMany: async ({ where }) =>
        consents.filter((c) => match(c, where)).sort((a, b) => b.version - a.version),
      count: async ({ where }) => consents.filter((c) => match(c, where)).length,
      create: async ({ data }) => {
        if (consents.some((c) => c.user_id === data.user_id && c.version === data.version))
          throw new Error("unique");
        const row = { id: consents.length + 1, agreed_at: new Date("2026-10-12T04:00:00Z"), ...data };
        consents.push(row);
        return row;
      },
    },
  };
  return db;
}

function fixture() {
  const db = fakeDb();
  const consent = load("utils/privacyConsent/index.js", { "../prisma": db });
  return { db, consent };
}
const allItems = { collection: true, external: true, noPatientInfo: true };

test("동의서가 없으면 v1 초안을 한 번만 넣고, 병원 이름은 '순천향대학교 부속 천안병원'이다", async () => {
  const { db, consent } = fixture();
  const first = await consent.currentDocument({ fresh: true });
  const again = await consent.currentDocument({ fresh: true });
  assert.equal(db.docs.length, 1);
  assert.equal(first.version, 1);
  assert.equal(again.version, 1);
  assert.match(first.label, /^v1 · \d{4}\.\d{2}$/);
  assert.match(first.content.fullText, /순천향대학교 부속 천안병원/);
  assert.doesNotMatch(first.content.fullText, /순천향대학교병원/);
  assert.equal(first.items.length, 3);
  for (const key of ["items", "purpose", "retention", "refusal"]) assert.ok(first.content.summary[key]);
  assert.match(first.content.external.storage, /Google Cloud \(서울 지역\)/);
  // 체크리스트 메모 줄과 전문
  assert.match(first.content.summary.checklist, /홍○동/);
  assert.match(first.content.summary.checklist, /24시간 보관 후 자동 삭제/);
  assert.match(first.content.summary.checklist, /그 PC에만 남습니다/);
  assert.match(first.content.summary.checklist, /AI\(Gemini\)로 보내지 않습니다/);
  assert.match(first.content.fullText, /체크리스트 메모: 업무용 환자 정보/);
  assert.match(first.content.fullText, /체크리스트 메모: AI\(Gemini\)로 보내지 않습니다/);
  assert.match(first.content.fullText, /질문 입력창에는 환자 이름/);
  assert.doesNotMatch(JSON.stringify(first.content), /김민지|김○지/);
  assert.equal(first.items[2].label, "질문 입력창에 환자 개인정보를 입력하지 않겠습니다.");
});

test("관리자가 고친 적 없는 예전 v1 초안은 버전·동의 기록을 그대로 두고 보완한 v1 문구로 바뀐다", async () => {
  const { db } = fixture();
  // 예전 초안: 체크리스트 줄이 없고 세 번째 문구가 달랐던 내용
  const { createHash } = require("node:crypto");
  const legacy = { summary: { items: "a", purpose: "b", retention: "c", refusal: "d" }, external: { storage: "e", generation: "f" }, fullText: "옛 문구" };
  const legacyJson = JSON.stringify(legacy);
  const hashes = [createHash("sha256").update(legacyJson).digest("hex")];
  const patched = load("utils/privacyConsent/index.js", {
    "../prisma": db,
    "./defaultDocument": { ...require("../../utils/privacyConsent/defaultDocument"), LEGACY_V1_SEED_HASHES: hashes },
  });
  db.docs.push({ id: 1, version: 1, label: "v1 · 2026.10", content: legacyJson, published_by: null, published_at: new Date() });
  db.consents.push({ id: 1, user_id: 7, version: 1, items: "{}", agreed_at: new Date() });
  const doc = await patched.currentDocument({ fresh: true });
  assert.equal(doc.version, 1);
  assert.equal(doc.label, "v1 · 2026.10");
  assert.match(doc.content.summary.checklist, /홍○동/);
  assert.equal(db.docs.length, 1);
  assert.equal(db.consents.length, 1);
  assert.equal(await patched.hasCurrentConsent(7), true);
  // 관리자가 고친 v1(게시자 있음)이나 다른 내용은 바꾸지 않는다.
  db.docs[0] = { ...db.docs[0], content: legacyJson, published_by: 3 };
  assert.equal((await patched.currentDocument({ fresh: true })).content.fullText, "옛 문구");
});

test("필수 3개를 모두 체크하고 지금 버전이어야 동의가 저장되며, 같은 버전은 한 번만 저장한다", async () => {
  const { db, consent } = fixture();
  assert.equal(await consent.hasCurrentConsent(7), false);
  await assert.rejects(
    consent.recordConsent(7, { version: 1, items: { collection: true, external: true } }),
    /필수 항목에 모두 동의/
  );
  await assert.rejects(consent.recordConsent(7, { version: 2, items: allItems }), /동의서가 바뀌었습니다/);
  await consent.recordConsent(7, { version: 1, items: allItems });
  await consent.recordConsent(7, { version: 1, items: allItems });
  assert.equal(db.consents.length, 1);
  assert.deepEqual(JSON.parse(db.consents[0].items), allItems);
  assert.equal(await consent.hasCurrentConsent(7), true);
  assert.equal(await consent.hasCurrentConsent(8), false);
});

test("관리자가 문구를 고치면 새 버전이 되고 모두 다시 동의해야 하며 지난 문구는 남는다", async () => {
  const { db, consent } = fixture();
  const v1 = await consent.currentDocument({ fresh: true });
  await consent.recordConsent(7, { version: 1, items: allItems });
  const input = JSON.parse(JSON.stringify(v1.content));
  await assert.rejects(consent.publishDocument(1, { ...input, baseVersion: 1 }), /바뀐 내용이 없습니다/);
  await assert.rejects(
    consent.publishDocument(1, { ...input, summary: { ...input.summary, retention: " " }, baseVersion: 1 }),
    /모든 칸을 채워/
  );
  input.summary.retention = "대화 기록은 1년 뒤 자동 삭제합니다.";
  await assert.rejects(consent.publishDocument(1, { ...input, baseVersion: 0 }), /그사이 동의서가 바뀌었습니다/);
  const v2 = await consent.publishDocument(1, { ...input, baseVersion: 1 });
  assert.equal(v2.version, 2);
  assert.match(v2.label, /^v2 · /);
  assert.equal(db.docs.length, 2);
  assert.equal(JSON.parse(db.docs[0].content).summary.retention, v1.content.summary.retention);
  assert.equal(await consent.hasCurrentConsent(7), false);
  await assert.rejects(consent.recordConsent(7, { version: 1, items: allItems }), /동의서가 바뀌었습니다/);
  await consent.recordConsent(7, { version: 2, items: allItems });
  assert.equal(await consent.hasCurrentConsent(7), true);
  const overview = await consent.adminOverview();
  assert.equal(overview.document.version, 2);
  assert.deepEqual(Array.from(overview.history.map((h) => h.version)), [2, 1]);
  assert.equal(overview.agreedCurrent, 1);
  const byUser = await consent.consentByUser([7, 9]);
  assert.equal(byUser.map.get(7).current, true);
  assert.equal(byUser.map.has(9), false);
  assert.equal((await consent.historyDocument(1)).content.summary.retention, v1.content.summary.retention);
});

test("동의 전에도 열려 있는 주소는 동의 화면·로그인 확인·내 정보뿐이다", () => {
  const { consent } = fixture();
  for (const p of ["/schat/privacy-consent", "/schat/privacy-consent/document", "/system/check-token", "/system/refresh-user", "/schat/me"])
    assert.equal(consent.exemptPath(p), true, p);
  for (const p of ["/workspace/x/stream-chat", "/schat/quiz/options", "/schat-admin/accounts", "/schat/me/password", "/schat/privacy-consentX"])
    assert.equal(consent.exemptPath(p), false, p);
});

// ---- 서버 문지기: 동의 전에는 기능 요청을 거절한다 ---------------------------------

function middleware(agreed, user = { id: 7, suspended: 0, must_change_password: false }) {
  const calls = [];
  const consent = {
    exemptPath: (p) => /^\/schat\/privacy-consent/.test(p) || p === "/schat/me",
    hasCurrentConsent: async (id) => {
      calls.push(id);
      return agreed;
    },
  };
  const mod = load("utils/middleware/validatedRequest.js", {
    "../../models/systemSettings": { SystemSettings: { isMultiUserMode: async () => true } },
    "../../models/user": { User: { get: async () => user } },
    "../EncryptionManager": { EncryptionManager: class {} },
    "../http": { decodeJWT: () => ({ id: user.id }) },
    "../userLocale": { UserMetaCache: { setFromRequest() {} } },
    "../privacyConsent": consent,
  });
  async function run(path) {
    const response = {
      locals: {},
      statusCode: 200,
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(body) {
        this.body = body;
        return this;
      },
    };
    let passed = false;
    await mod.validatedRequest({ path, header: () => "Bearer token" }, response, () => {
      passed = true;
    });
    return { passed, response };
  }
  return { run, calls };
}

test("동의하지 않은 사람의 질문·퀴즈·관리자 요청은 403으로 거절하고 동의 화면 요청은 통과한다", async () => {
  const blocked = middleware(false);
  for (const p of ["/workspace/x/stream-chat", "/schat/quiz/options", "/schat-admin/accounts"]) {
    const { passed, response } = await blocked.run(p);
    assert.equal(passed, false, p);
    assert.equal(response.statusCode, 403);
    assert.equal(response.body.consentRequired, true);
  }
  for (const p of ["/schat/privacy-consent", "/schat/me"]) {
    const { passed, response } = await blocked.run(p);
    assert.equal(passed, true, p);
    assert.equal(response.locals.user.id, 7);
  }
  const allowed = middleware(true);
  assert.equal((await allowed.run("/workspace/x/stream-chat")).passed, true);
});

// ---- 처음 비밀번호 만들기: 동의와 비밀번호를 한 번에 저장 ---------------------------

function accountFixture({ agreed = false } = {}) {
  const user = { id: 7, employee_number: "1234567", must_change_password: true, suspended: 0, display_name: "가짜직원", department: { name: "가짜부서" } };
  const saved = { password: null, consent: null };
  const consent = {
    hasCurrentConsent: async () => agreed,
    currentDocument: async () => ({ version: 1, label: "v1 · 2026.10", items: [] }),
    validateAgreement: (agreement, doc) => {
      if (!agreement || agreement.version !== doc.version) throw new Error("동의서가 바뀌었습니다.");
      if (!agreement.items?.collection || !agreement.items?.external || !agreement.items?.noPatientInfo)
        throw new Error("필수 항목에 모두 동의해야 SCHAT을 이용할 수 있습니다.");
    },
    recordConsent: async (id, agreement, { db }) => {
      assert.ok(db.inTransaction, "동의는 비밀번호와 같은 저장 단위");
      saved.consent = { id, version: agreement.version };
    },
  };
  const tx = {
    inTransaction: true,
    users: {
      updateMany: async ({ data }) => {
        saved.password = data.password;
        return { count: 1 };
      },
    },
  };
  const prisma = {
    users: { findUnique: async () => user },
    $transaction: async (fn) => fn(tx),
  };
  const core = {
    normalizeEmployeeNumber: (n) => n,
    checkFirstLogin: () => ({ ok: true }),
    checkFirstLoginIdentity: () => ({ ok: true }),
    LOGIN_FAILED_MESSAGE: "실패",
  };
  const service = load("utils/schatAccounts/service.js", {
    "../prisma": prisma,
    "./core": core,
    "../privacyConsent": consent,
  });
  return { service, saved };
}

test("처음 비밀번호 만들기: 동의가 없으면 비밀번호도 저장하지 않고, 동의하면 함께 저장한다", async () => {
  const f = accountFixture();
  const check = await f.service.firstLoginCheck({ employeeNumber: "1234567" });
  assert.equal(check.consentRequired, true);
  assert.equal(check.consentDocument.version, 1);
  const refused = await f.service.firstLogin({ employeeNumber: "1234567", newPassword: "abcd1234!" });
  assert.equal(refused.user, null);
  assert.equal(refused.consentInvalid, true);
  assert.equal(f.saved.password, null);
  const partial = await f.service.firstLogin({
    employeeNumber: "1234567",
    newPassword: "abcd1234!",
    consent: { version: 1, items: { collection: true, external: true } },
  });
  assert.equal(partial.consentInvalid, true);
  assert.equal(f.saved.password, null);
  await f.service.firstLogin({
    employeeNumber: "1234567",
    newPassword: "abcd1234!",
    consent: { version: 1, items: allItems },
  });
  assert.ok(f.saved.password);
  assert.deepEqual(f.saved.consent, { id: 7, version: 1 });
});

test("비밀번호 초기화 뒤 다시 만들 때 이미 동의했으면 묻지 않는다", async () => {
  const f = accountFixture({ agreed: true });
  const check = await f.service.firstLoginCheck({ employeeNumber: "1234567" });
  assert.equal(check.consentRequired, false);
  assert.equal("consentDocument" in check, false);
  await f.service.firstLogin({ employeeNumber: "1234567", newPassword: "abcd1234!" });
  assert.ok(f.saved.password);
  assert.equal(f.saved.consent, null);
});
