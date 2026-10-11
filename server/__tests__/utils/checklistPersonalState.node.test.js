const test = require("node:test");
const assert = require("node:assert/strict");
const { DatabaseSync } = require("node:sqlite");
const {
  createPersonalStateStore,
} = require("../../utils/checklistPersonalState");
const fs = require("node:fs");
const path = require("node:path");

function setup(t) {
  const sqlite = new DatabaseSync(":memory:");
  t.after(() => sqlite.close());
  sqlite.exec(
    fs.readFileSync(
      path.join(
        __dirname,
        "../../prisma/migrations/20261011020000_checklist_personal_state/migration.sql"
      ),
      "utf8"
    )
  );
  const db = {
    $queryRawUnsafe: async (sql, ...args) => sqlite.prepare(sql).all(...args),
    $executeRawUnsafe: async (sql, ...args) =>
      sqlite.prepare(sql).run(...args).changes,
  };
  let now = 1000;
  return {
    store: createPersonalStateStore(db, () => now),
    advance: (ms) => (now += ms),
  };
}
const body = {
  revision: null,
  checks: { first: true },
  patient: "612호 / 홍○동",
  other: "합성 시험 메모",
};

test("owner isolation and server timestamps", async (t) => {
  const { store } = setup(t);
  const saved = await store.save(1, "a", body);
  assert.equal(saved.updatedAt, 1000);
  assert.equal(saved.expiresAt, 86401000);
  assert.equal((await store.read(1, "a")).other, body.other);
  assert.equal(await store.read(2, "a"), null);
  await assert.rejects(store.save(null, "a", body));
});
test("stale PC and simultaneous initial writes cannot overwrite", async (t) => {
  const { store } = setup(t);
  const first = await store.save(1, "a", body);
  await assert.rejects(store.save(1, "a", body), { code: "CONFLICT" });
  const next = await store.save(1, "a", {
    ...body,
    revision: first.revision,
    other: "수정",
  });
  await assert.rejects(
    store.save(1, "a", { ...body, revision: first.revision }),
    { code: "CONFLICT" }
  );
  assert.equal((await store.read(1, "a")).revision, next.revision);
});
test("24h boundary expires, old revision cannot resurrect, cleanup deletes", async (t) => {
  const { store, advance } = setup(t);
  const first = await store.save(1, "a", body);
  advance(86400000);
  assert.equal(await store.read(1, "a"), null);
  await assert.rejects(
    store.save(1, "a", { ...body, revision: first.revision }),
    { code: "CONFLICT" }
  );
  assert.equal(await store.cleanup(), 1);
});
test("read does not renew lifetime; edit does", async (t) => {
  const { store, advance } = setup(t);
  const first = await store.save(1, "a", body);
  advance(3000);
  assert.equal((await store.read(1, "a")).expiresAt, first.expiresAt);
  const edited = await store.save(1, "a", {
    ...body,
    revision: first.revision,
    other: "변경",
  });
  assert.equal(edited.expiresAt, first.expiresAt + 3000);
});
test("invalid input errors do not echo private values", async (t) => {
  const { store } = setup(t);
  await assert.rejects(
    store.save(1, "a", { ...body, other: "x".repeat(10001) }),
    { message: "INVALID_STATE" }
  );
  await assert.rejects(
    store.save(1, "a", { ...body, checks: { first: "private" } }),
    { message: "INVALID_STATE" }
  );
});
test("saving unchanged content must not extend retention", async (t) => {
  const { store, advance } = setup(t);
  const first = await store.save(1, "a", body);
  advance(5000);
  const same = await store.save(1, "a", { ...body, revision: first.revision });
  assert.equal(same.expiresAt, first.expiresAt);
});
