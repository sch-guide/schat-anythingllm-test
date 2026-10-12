const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const core = require("../../../utils/schatQuiz/core");

// 모든 자료와 저장 작업은 이 검사 안의 메모리에만 존재한다.
function fixture() {
  let state = {
    users: [{ id: 1, role: "admin", suspended: 0 }, { id: 7, role: "default", suspended: 0 }],
    workspaces: [{ id: 1, slug: "fake" }],
    workspace_documents: [{ workspaceId: 1, metadata: '{"document_id":"live","page":1}' }],
    schat_quiz_questions: [
      ...["draft", "approved", "inactive", "deleted"].map((status, i) => ({ id: i + 1, document_id: "live", status })),
      { id: 5, document_id: "old", status: "approved" },
    ],
    schat_quiz_attempts: [{ id: 1, user_id: 7, score: 50 }],
    schat_quiz_answers: [{ id: 1, user_id: 7, attempt_id: 1, question_id: 5 }],
    schat_quiz_wrong_notes: [{ id: 1, user_id: 7, question_id: 5 }],
    system_settings: [{ id: 1, label: "unrelated", value: "keep" }],
    schat_quiz_sets: [{ id: 1, title: "keep" }],
    schat_quiz_generation_logs: [{ id: 1, status: "keep" }],
  };
  let failure = null;
  const match = (row, where = {}) => Object.entries(where).every(([k, v]) =>
    v && typeof v === "object" ? (!v.in || v.in.includes(row[k])) : row[k] === v);
  function client() {
    return Object.fromEntries(Object.keys(state).map((name) => [name, {
      findMany: async ({ where } = {}) => structuredClone(state[name].filter((r) => match(r, where))),
      findUnique: async ({ where }) => structuredClone(state[name].find((r) => match(r, where)) || null),
      deleteMany: async ({ where } = {}) => {
        if (failure === name) throw Error("synthetic failure");
        const before = state[name].length;
        state[name] = state[name].filter((r) => !match(r, where));
        return { count: before - state[name].length };
      },
      upsert: async ({ where, create, update }) => {
        const row = state[name].find((r) => match(r, where));
        if (row) { Object.assign(row, update); return structuredClone(row); }
        state[name].push({ id: state[name].length + 1, ...create });
        return structuredClone(state[name].at(-1));
      },
      create: async ({ data }) => {
        const row = { id: state[name].length + 1, ...data };
        state[name].push(row); return structuredClone(row);
      },
    }]));
  }
  const db = client();
  db.$transaction = async (fn) => {
    if (Array.isArray(fn)) return Promise.all(fn);
    const before = structuredClone(state);
    try { return await fn(client()); } catch (e) { state = before; throw e; }
  };
  const filename = path.resolve(__dirname, "../../../utils/schatQuiz/bank.js");
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(filename, "utf8"), {
    module, console, Date, Map, Set, Buffer,
    require: (name) => name === "../prisma" ? db : name === "./core" ? core :
      require(require.resolve(name, { paths: [path.dirname(filename)] })),
  }, { filename });
  return { bank: module.exports, db, state: () => state, fail: (name) => { failure = name; } };
}

test("수동 초기화 기능은 명시적인 미리보기와 실행을 제공한다", () => {
  const { bank } = fixture();
  assert.equal(typeof bank.resetPreview, "function");
  assert.equal(typeof bank.resetRecords, "function");
});

test("모든 직원 기록을 지우고 현재문서 작성중·공개·중지 문제와 다른 표를 보존한다", async () => {
  const f = fixture();
  const p = await f.bank.resetPreview(1);
  assert.equal(p.staffCount, 1);
  assert.equal(p.attemptCount, 1);
  assert.equal(p.questionCount, 2);
  const before = structuredClone(f.state());
  const result = await f.bank.resetRecords(1, { confirm: "초기화", token: p.token });
  assert.equal(result.generation, 1);
  for (const name of ["schat_quiz_attempts", "schat_quiz_answers", "schat_quiz_wrong_notes"])
    assert.equal(f.state()[name].length, 0);
  assert.deepEqual(f.state().schat_quiz_questions.map((q) => q.id), [1, 2, 3]);
  for (const name of ["users", "workspaces", "workspace_documents", "schat_quiz_sets", "schat_quiz_generation_logs"])
    assert.deepEqual(f.state()[name], before[name]);
  assert.equal(f.state().system_settings.find((r) => r.label === "unrelated").value, "keep");
});

test("비관리자·확인어 오류·같은 건수의 자료 교체는 삭제 없이 거절한다", async () => {
  const f = fixture();
  await assert.rejects(f.bank.resetPreview(7), /권한/);
  const p = await f.bank.resetPreview(1);
  await assert.rejects(f.bank.resetRecords(1, { confirm: " 초기화", token: p.token }), /초기화/);
  f.state().schat_quiz_answers[0].id = 22;
  await assert.rejects(f.bank.resetRecords(1, { confirm: "초기화", token: p.token }), /다시 확인/);
  assert.equal(f.state().schat_quiz_answers.length, 1);
  assert.equal(f.state().schat_quiz_attempts.length, 1);
});

test("중간 저장 실패는 삭제와 초기화 세대를 함께 되돌린다", async () => {
  const f = fixture();
  const p = await f.bank.resetPreview(1);
  const before = structuredClone(f.state());
  f.fail("schat_quiz_questions");
  await assert.rejects(f.bank.resetRecords(1, { confirm: "초기화", token: p.token }), /synthetic failure/);
  assert.deepEqual(f.state(), before);
});

test("초기화 세대별 계정별 읽음 표시는 재로그인 뒤에도 유지된다", async () => {
  const f = fixture();
  assert.equal(await f.bank.resetNotice(7), null);
  const p = await f.bank.resetPreview(1);
  await f.bank.resetRecords(1, { confirm: "초기화", token: p.token });
  const notice = await f.bank.resetNotice(7);
  assert.equal(notice.generation, 1);
  await f.bank.acknowledgeReset(7, 1);
  assert.equal(await f.bank.resetNotice(7), null);
  assert.equal((await f.bank.resetNotice(1)).generation, 1);
  await assert.rejects(f.bank.acknowledgeReset(7, 2), /다시 확인/);
  const p2 = await f.bank.resetPreview(1);
  await f.bank.resetRecords(1, { confirm: "초기화", token: p2.token });
  assert.equal((await f.bank.resetNotice(7)).generation, 2);
});

test("초기화 전에 시작된 저장이 끝난 뒤 대상 변경을 감지하며 초기화 이후 저장은 새 경계를 사용한다", async () => {
  const f = fixture();
  const p = await f.bank.resetPreview(1);
  let release;
  const wait = new Promise((r) => { release = r; });
  let entered;
  const started = new Promise((r) => { entered = r; });
  const writer = f.bank.withQuizWrite(async () => {
    entered(); await wait;
    f.state().schat_quiz_attempts.push({ id: 2, user_id: 7 });
  });
  await started;
  const reset = f.bank.resetRecords(1, { confirm: "초기화", token: p.token });
  release();
  await writer;
  await assert.rejects(reset, /다시 확인/);
  assert.equal(f.state().schat_quiz_attempts.length, 2);
});

test("서버는 관리자 초기화 경로와 직원별 안내 경로를 제공한다", async () => {
  const f = fixture();
  const filename = path.resolve(__dirname, "../../../endpoints/schatQuiz.js");
  const module = { exports: {} }, routes = new Map();
  const roleFile = path.resolve(__dirname, "../../../utils/middleware/multiUserProtected.js");
  const roleModule = { exports: {} };
  vm.runInNewContext(fs.readFileSync(roleFile, "utf8"), { module: roleModule,
    require: (name) => name === "../../models/systemSettings" ? { SystemSettings: { isMultiUserMode: async () => true } } : { userFromSession: async () => null },
  });
  const deps = {
    "../utils/http": { reqBody: (r) => r.body },
    "../utils/middleware/validatedRequest": { validatedRequest: (_r, _s, next) => next() },
    "../utils/middleware/multiUserProtected": roleModule.exports,
    "../utils/schatQuiz/bank": f.bank,
  };
  vm.runInNewContext(fs.readFileSync(filename, "utf8"), { module, console, require: (name) => deps[name] });
  module.exports.schatQuizEndpoints(Object.fromEntries(["get", "post", "patch", "delete"].map((method) =>
    [method, (url, ...handlers) => routes.set(`${method} ${url}`, handlers.flat())])));
  assert.ok(routes.has("post /schat-admin/quiz/reset"));
  async function request(method, url, user, body = {}) {
    const response = { locals: { user, multiUserMode: true }, code: 200,
      status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; },
      sendStatus(code) { this.code = code; return this; }, end() { return this; } };
    for (const handler of routes.get(`${method} ${url}`)) {
      let next = false; await handler({ method, body }, response, () => { next = true; });
      if (!next) break;
    }
    return response;
  }
  const staff = { id: 7, role: "default" }, admin = { id: 1, role: "admin" };
  assert.equal((await request("post", "/schat-admin/quiz/reset", staff)).code, 401);
  assert.equal((await request("post", "/schat-admin/quiz/reset", admin, { confirm: " 초기화" })).code, 400);
  const p = await request("get", "/schat-admin/quiz/reset/preview", admin);
  assert.equal(p.body.attemptCount, 1);
  assert.equal((await request("post", "/schat-admin/quiz/reset", admin, { confirm: "초기화", token: p.body.token })).code, 200);
  const n = await request("get", "/schat/quiz/reset-notice", staff);
  assert.equal(n.body.notice.generation, 1);
  await request("post", "/schat/quiz/reset-notice", staff, { generation: 1 });
  assert.equal((await request("get", "/schat/quiz/reset-notice", staff)).body.notice, null);
});

test("AI 응답 완료 저장은 초기화 저장 경계 안에서만 이루어진다", async () => {
  const f = fixture();
  const filename = path.resolve(__dirname, "../../../utils/schatQuiz/generation.js");
  const module = { exports: {} };
  const deps = { "../prisma": f.db, "./core": core, "./bank": f.bank,
    "../helpers": {}, "../vectorDbProviders/chroma/schatBm25": { rankByBm25: (_topic, rows) => rows } };
  vm.runInNewContext(fs.readFileSync(filename, "utf8"), { module, console, Date, Map, Set,
    require: (name) => deps[name] });
  f.bank.withQuizWrite = async () => { throw Error("synthetic held boundary"); };
  const before = structuredClone(f.state().schat_quiz_sets);
  await assert.rejects(module.exports.generate(1, { docKey: core.docKeyOf("live"), topic: "합성", count: 1,
    difficulty: "beginner", questionType: "ox" }, {
    vectorDb: { connect: async () => ({ client: { getCollection: async () => ({ get: async () => ({
      ids: ["one"], documents: ["합성 근거입니다."], metadatas: [{ page: 1 }],
    }) }) } }) },
    llm: { getChatCompletion: async () => ({ textResponse: JSON.stringify({ questions: [{
      question: "합성 질문?", choices: [], correctIndex: -1, oxAnswer: "O", explanation: "합성 근거입니다.",
      sourcePage: 1, evidenceQuote: "합성 근거입니다.",
    }] }) }) },
  }), /synthetic held boundary/);
  assert.deepEqual(f.state().schat_quiz_sets, before);
});

test("초기화와 겹친 이전 퀴즈 제출·오답복습·오답삭제는 기록을 되살리지 않는다", async () => {
  const f = fixture();
  const preview = await f.bank.resetPreview(1);
  let release, entered;
  const gate = new Promise((r) => { release = r; });
  const ready = new Promise((r) => { entered = r; });
  const reset = f.bank.withQuizWrite(async () => {
    entered(); await gate;
    return f.bank.resetRecords(1, { confirm: "초기화", token: preview.token });
  });
  await ready;
  const answer = f.bank.answerQuestion(7, 1, 5, { ox: "X" });
  const review = f.bank.startWrongReview(7);
  const remove = f.bank.removeWrongNote(7, 1);
  const rejected = [assert.rejects(answer, /찾을 수/), assert.rejects(review, /틀린 문제/), assert.rejects(remove, /찾을 수/)];
  release(); await reset; await Promise.all(rejected);
  assert.equal(f.state().schat_quiz_attempts.length, 0);
  assert.equal(f.state().schat_quiz_answers.length, 0);
  assert.equal(f.state().schat_quiz_wrong_notes.length, 0);
  const start = await f.bank.startAttempt(7, { count: 1 });
  assert.equal(start.total, 1);
  assert.equal(f.state().schat_quiz_attempts.length, 1);
});
