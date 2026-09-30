// 부서 삭제: only a department without accounts is deleted; the check is
// repeated inside the delete itself. A fake database is used (no real data).
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const service = require("../../../utils/schatAccounts/service");

function fakeDb(departments) {
  const rows = new Map(departments.map((d) => [d.id, { ...d }]));
  const calls = [];
  return {
    rows,
    calls,
    schat_departments: {
      async findUnique({ where }) {
        const row = rows.get(where.id);
        return row ? { ...row, _count: { users: row.users } } : null;
      },
      async deleteMany({ where }) {
        calls.push(where);
        const row = rows.get(where.id);
        // same rule as the real statement: users: { none: {} }
        if (!row || !where.users?.none || row.users > 0) return { count: 0 };
        rows.delete(where.id);
        return { count: 1 };
      },
    },
  };
}

test("a department with 0 accounts is deleted and logged", async () => {
  const db = fakeDb([
    { id: 1, name: "E2E테스트부서", users: 0 },
    { id: 2, name: "131병동", users: 15 },
  ]);
  const logs = [];
  const result = await service.deleteDepartment(9, 1, {
    db,
    log: (...args) => logs.push(args),
  });
  assert.deepEqual(result, { id: 1, name: "E2E테스트부서" });
  assert.equal(db.rows.has(1), false);
  assert.equal(db.rows.has(2), true); // other departments untouched
  assert.deepEqual(logs, [
    ["schat_department_deleted", { departmentId: 1, name: "E2E테스트부서" }, 9],
  ]);
  // the delete statement itself carries the "no accounts" condition
  assert.deepEqual(db.calls[0], { id: 1, users: { none: {} } });
});

test("a department with accounts is refused before deleting", async () => {
  const db = fakeDb([{ id: 2, name: "131병동", users: 15 }]);
  await assert.rejects(
    () => service.deleteDepartment(9, 2, { db, log: () => {} }),
    (error) =>
      error.userFacing === true &&
      /직원 15명이 소속된 부서는 삭제할 수 없습니다/.test(error.message)
  );
  assert.equal(db.rows.has(2), true);
  assert.equal(db.calls.length, 0);
});

test("an account added between the check and the delete still blocks it", async () => {
  const db = fakeDb([{ id: 3, name: "경합부서", users: 0 }]);
  const original = db.schat_departments.findUnique;
  db.schat_departments.findUnique = async (args) => {
    const row = await original(args);
    db.rows.get(3).users = 1; // someone registers an employee right now
    return row;
  };
  await assert.rejects(
    () => service.deleteDepartment(9, 3, { db, log: () => {} }),
    /직원이 소속되어 있어 삭제하지 않았습니다/
  );
  assert.equal(db.rows.has(3), true);
});

test("unknown or invalid ids are refused", async () => {
  const db = fakeDb([]);
  for (const id of [99, "abc", 0, -1])
    await assert.rejects(
      () => service.deleteDepartment(9, id, { db, log: () => {} }),
      /부서를 찾을 수 없습니다/
    );
});

test("the delete endpoint is admin only and goes through the service", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "../../../endpoints/schatAccounts.js"),
    "utf8"
  );
  const block = source.slice(
    source.indexOf('app.delete(\n    "/schat-admin/departments/:id"'),
    source.indexOf("// ---- admin: bulk registration")
  );
  assert.match(block, /adminOnly/);
  assert.match(block, /service\.deleteDepartment\(/);
  assert.doesNotMatch(block, /prisma|users\.delete/);
});
