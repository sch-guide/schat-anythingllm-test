const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const api = (() => {
  try {
    return require("../../utils/answerFeedback");
  } catch {
    return {};
  }
})();
const migration = path.join(
  __dirname,
  "../../prisma/migrations/20261012010000_answer_feedback/migration.sql"
);
test("이름 호칭 뒤 조사도 가리고 지침 용어는 그대로 보존", () => {
  const masked = api.maskMemo("김민지님은 홍길동환자가 이름: 이영희는 확인 / 산소포화도 환자는 유지");
  assert.equal(masked,"김○지님은 홍○동환자가 이름: 이○희는 확인 / 산소포화도 환자는 유지");
});
test("호칭 뒤 복합 조사도 원래 이름을 남기지 않음", () => {
  assert.equal(api.maskMemo("김민지님께서는 홍길동님에게도 이영희환자에게는 확인"),"김○지님께서는 홍○동님에게도 이○희환자에게는 확인");
});
test("한국 오전 평가도 같은 한국 날짜 범위에 포함", async t => {
  const {db} = setup(t);
  const store = api.createAnswerFeedbackStore(db, () => Date.parse("2026-10-12T08:00:00+09:00"));
  await store.save(7,2,11,{feedback:false,reason:"wrong"});
  assert.equal((await store.list({from:"2026-10-12",to:"2026-10-12"})).length,1);
  assert.equal((await store.list({from:"2026-10-11",to:"2026-10-11"})).length,0);
});
function setup(t) {
  const sqlite = new DatabaseSync(":memory:");
  t.after(() => sqlite.close());
  sqlite.exec(`CREATE TABLE workspace_chats(id INTEGER PRIMARY KEY, workspaceId INTEGER, user_id INTEGER, prompt TEXT, response TEXT, feedbackScore BOOLEAN);
    CREATE TABLE users(id INTEGER PRIMARY KEY, department_id INTEGER); CREATE TABLE schat_departments(id INTEGER PRIMARY KEY, name TEXT);
    INSERT INTO users VALUES(7,1),(8,1); INSERT INTO schat_departments VALUES(1,'시험부서');
    INSERT INTO workspace_chats VALUES(11,2,7,'가짜 질문','{"text":"전체 답변","sources":[{"title":"합성 지침","page":3}]}',1);`);
  const before = sqlite
    .prepare(
      "SELECT name,sql FROM sqlite_master WHERE type='table' ORDER BY name"
    )
    .all();
  const data = sqlite.prepare("SELECT * FROM workspace_chats").all();
  assert.ok(fs.existsSync(migration), "평가 표 추가 migration이 있어야 함");
  sqlite.exec(fs.readFileSync(migration, "utf8"));
  assert.deepEqual(
    sqlite
      .prepare(
        "SELECT name,sql FROM sqlite_master WHERE type='table' AND name!='schat_answer_feedback' AND name!='sqlite_sequence' ORDER BY name"
      )
      .all(),
    before
  );
  assert.deepEqual(sqlite.prepare("SELECT * FROM workspace_chats").all(), data);
  const db = {
    $queryRawUnsafe: async (sql, ...args) => sqlite.prepare(sql).all(...args),
    $executeRawUnsafe: async (sql, ...args) =>
      sqlite.prepare(sql).run(...args).changes,
    $transaction: async (fn) => {
      sqlite.exec("BEGIN");
      try {
        const value = await fn(db);
        sqlite.exec("COMMIT");
        return value;
      } catch (e) {
        sqlite.exec("ROLLBACK");
        throw e;
      }
    },
  };
  assert.equal(typeof api.createAnswerFeedbackStore, "function");
  return { sqlite, db, store: api.createAnswerFeedbackStore(db, () => 1000) };
}
test("새 표만 추가하며 과거 좋아요와 모든 기존 자료를 보존", (t) => {
  setup(t);
});
test("자기 대화만 저장, 이유 필수, 200자 검증과 서버 가리기", async (t) => {
  const { store } = setup(t);
  for (const args of [
    [8, 2, 11, { feedback: false, reason: "wrong" }],
    [7, 3, 11, { feedback: false, reason: "wrong" }],
  ])
    await assert.rejects(store.save(...args), { code: "NOT_FOUND" });
  for (const input of [
    { feedback: false },
    { feedback: false, reason: "other" },
    { feedback: false, reason: "wrong", memo: "가".repeat(201) },
    { feedback: 0 },
  ])
    await assert.rejects(store.save(7, 2, 11, input), {
      code: "INVALID_FEEDBACK",
    });
  const saved = await store.save(7, 2, 11, {
    feedback: false,
    reason: "not_found",
    memo: "김민지님 12345678 / 환자 홍길동 / 이영희 환자",
  });
  assert.equal(saved.memo, "김○지님 1234**** / 환자 홍○동 / 이○희 환자");
  assert.equal(saved.chatId, 11);
  assert.equal(saved.reason, "not_found");
});
test("좋아요와 싫어요 전환·취소는 같은 transaction에서 이유와 메모를 제거", async (t) => {
  const { store, sqlite, db } = setup(t);
  await store.save(7, 2, 11, {
    feedback: false,
    reason: "wrong",
    memo: "합성 메모",
  });
  await store.save(7, 2, 11, { feedback: true });
  assert.equal(
    sqlite.prepare("SELECT feedbackScore FROM workspace_chats").get()
      .feedbackScore,
    1
  );
  const row = sqlite.prepare("SELECT * FROM schat_answer_feedback").get();
  assert.equal(row.reason, null);
  assert.equal(row.memo, null);
  await store.save(7, 2, 11, { feedback: null });
  assert.equal(
    sqlite.prepare("SELECT count(*) AS n FROM schat_answer_feedback").get().n,
    0
  );
  assert.equal(
    sqlite.prepare("SELECT feedbackScore FROM workspace_chats").get()
      .feedbackScore,
    null
  );
  const execute = db.$executeRawUnsafe;
  db.$executeRawUnsafe = async (sql, ...args) => {
    if (sql.startsWith("UPDATE workspace_chats"))
      throw new Error("private driver values");
    return execute(sql, ...args);
  };
  await assert.rejects(
    store.save(7, 2, 11, {
      feedback: false,
      reason: "wrong",
      memo: "비공개 메모",
    })
  );
  assert.equal(
    sqlite.prepare("SELECT count(*) AS n FROM schat_answer_feedback").get().n,
    0
  );
  assert.equal(
    sqlite.prepare("SELECT feedbackScore FROM workspace_chats").get()
      .feedbackScore,
    null
  );
});
test("관리자 목록 필터·전체 답변과 참고 지침·처리 완료·취소 반영", async (t) => {
  const { store } = setup(t);
  await store.save(7, 2, 11, {
    feedback: false,
    reason: "not_found",
    memo: "합성 메모",
  });
  assert.equal((await store.list({ kind: "wrong" })).length, 0);
  assert.equal((await store.list({ kind: "report" })).length, 0);
  const [row] = await store.list({
    kind: "not_found",
    status: "open",
    department: "시험부서",
  });
  assert.equal(row.question, "가짜 질문");
  assert.equal(row.memo, "합성 메모");
  const detail = await store.detail(row.id);
  assert.equal(detail.answer, "전체 답변");
  assert.deepEqual(detail.sources, [{ title: "합성 지침", page: 3 }]);
  await store.resolve(row.id);
  assert.equal((await store.list({ status: "open" })).length, 0);
  assert.equal((await store.detail(row.id)).status, "resolved");
  await store.save(7, 2, 11, { feedback: false, reason: "wrong" });
  assert.equal((await store.list({ kind: "wrong", status: "open" })).length, 1);
  await store.save(7, 2, 11, { feedback: null });
  assert.equal((await store.list()).length, 0);
});
