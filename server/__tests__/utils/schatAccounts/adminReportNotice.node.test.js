// 2026-11-09: 새 문제신고가 들어오면 관리자 알림함에도 알린다. 가짜 DB만 쓴다.
const test = require("node:test");
const assert = require("node:assert/strict");
const { notifyAdminsOfReport } = require("../../../utils/schatAccounts/service");

function fakeDb(admins, { failCreate = false } = {}) {
  const created = [];
  const queries = [];
  return {
    created,
    queries,
    users: {
      async findMany(args) {
        queries.push(args.where);
        return admins.filter((id) => id !== args.where.id.not).map((id) => ({ id }));
      },
    },
    schat_user_notifications: {
      create({ data }) {
        if (failCreate) return Promise.reject(Object.assign(new Error("x"), { code: "P2003" }));
        created.push(data);
        return Promise.resolve(data);
      },
    },
    $transaction: (list) => Promise.all(list),
  };
}

test("새 신고는 정지되지 않은 관리자에게만, 신고한 관리자 본인은 빼고 알린다", async () => {
  const db = fakeDb([1, 2, 3]);
  await notifyAdminsOfReport({ id: 40, category: "답변 내용" }, 2, { db });
  assert.deepEqual(db.queries[0], { role: "admin", suspended: 0, id: { not: 2 } });
  assert.deepEqual(db.created.map((row) => row.user_id), [1, 3]);
  assert.deepEqual(db.created[0], {
    user_id: 1,
    report_id: 40,
    kind: "admin_new_report",
    message: "새 문제신고가 접수되었습니다 (답변 내용).",
  });
});

test("알림을 못 넣어도 신고 저장은 막지 않는다", async () => {
  const db = fakeDb([1], { failCreate: true });
  const errors = [];
  const original = console.error;
  console.error = (...args) => errors.push(args.join(" "));
  try {
    await notifyAdminsOfReport({ id: 41, category: "기타" }, 9, { db });
  } finally {
    console.error = original;
  }
  assert.equal(errors.length, 1);
  assert.doesNotMatch(errors[0], /기타|41/); // 신고 내용은 기록하지 않음
});
