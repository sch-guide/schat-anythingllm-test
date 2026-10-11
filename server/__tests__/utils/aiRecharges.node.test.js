const test = require("node:test");
const assert = require("node:assert/strict");
const {
  createRechargeStore,
  createFeesLoader,
  SETTING_KEY,
} = require("../../utils/aiRecharges");
function setup() {
  const settings = new Map([
    ["schat_gemini_budget", { monthlyBudgetKrw: 123 }],
  ]);
  let id = 0;
  const deps = {
    now: () => new Date("2026-10-11T02:00:00Z"),
    id: () => `record-${++id}`,
    readSetting: async (key) => structuredClone(settings.get(key) || null),
    compareAndSwapSetting: async (key, revision, next) => {
      if ((settings.get(key)?.revision || 0) !== revision) return false;
      settings.set(key, structuredClone(next));
      return true;
    },
  };
  return {
    settings,
    store: createRechargeStore(deps),
    restart: () => createRechargeStore(deps),
  };
}
test("CRUD uses stable IDs and persisted revision, survives restart, preserves legacy settings", async () => {
  const { store, restart, settings } = setup();
  const created = await store.mutate({
    revision: 0,
    amountKrw: 8000,
    date: "2026-10-10",
  });
  assert.equal(created.revision, 1);
  assert.equal(created.records[0].id, "record-1");
  const edited = await restart().mutate(
    { revision: 1, id: "record-1", amountKrw: 9000, date: "2026-10-11" },
    "update"
  );
  assert.equal(edited.records[0].id, "record-1");
  assert.equal(edited.records[0].amountKrw, 9000);
  assert.deepEqual(await restart().read(), edited);
  assert.deepEqual(
    await store.mutate({ revision: 2, id: "record-1" }, "delete"),
    { revision: 3, records: [] }
  );
  assert.deepEqual(settings.get("schat_gemini_budget"), {
    monthlyBudgetKrw: 123,
  });
  assert.equal(SETTING_KEY, "schat_ai_recharges");
});
test("two administrators with the same revision cannot lose each other changes", async () => {
  const { store, restart } = setup();
  const results = await Promise.allSettled([
    store.mutate({ revision: 0, amountKrw: 10, date: "2026-10-11" }),
    restart().mutate({ revision: 0, amountKrw: 20, date: "2026-10-11" }),
  ]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(results.find((r) => r.status === "rejected").reason.status, 409);
  assert.equal((await store.read()).records.length, 1);
});
test("invalid amounts, calendar days, future dates, IDs and revisions cannot be saved", async () => {
  const { store } = setup();
  for (const amountKrw of [0, -1, NaN, Infinity, "100", 1e13])
    await assert.rejects(
      store.mutate({ revision: 0, amountKrw, date: "2026-10-11" }),
      { status: 400 }
    );
  for (const date of [
    "2026-02-30",
    "2026-13-01",
    "2026-1-01",
    "2026-10-12",
    "0000-01-01",
    "",
    null,
  ])
    await assert.rejects(store.mutate({ revision: 0, amountKrw: 10, date }), {
      status: 400,
    });
  await assert.rejects(
    store.mutate({ revision: -1, amountKrw: 10, date: "2026-10-11" }),
    { status: 400 }
  );
  await assert.rejects(
    store.mutate(
      { revision: 0, id: "absent", amountKrw: 10, date: "2026-10-11" },
      "update"
    ),
    { status: 404 }
  );
});
test("history is bounded at 1000 records", async () => {
  const { settings, store } = setup();
  settings.set(SETTING_KEY, {
    revision: 5,
    records: Array.from({ length: 1000 }, (_, i) => ({
      id: String(i),
      amountKrw: 1,
      date: "2026-10-11",
    })),
  });
  await assert.rejects(
    store.mutate({ revision: 5, amountKrw: 1, date: "2026-10-11" }),
    { status: 400 }
  );
});
test("summary cache coalesces in flight reads, expires after thirty seconds and invalidates after recharge changes", async () => {
  let saved = {
      revision: 1,
      records: [{ id: "a", date: "2026-10-10", amountKrw: 8000 }],
    },
    queries = 0,
    clock = 0;
  const load = createFeesLoader({
    read: async () => saved,
    readRows: async () => {
      queries++;
      return [];
    },
    clock: () => clock,
  });
  const now = new Date("2026-10-11T02:00:00Z");
  const [a, b] = await Promise.all([load(now), load(now)]);
  assert.equal(a, b);
  assert.equal(queries, 1);
  await load(now);
  assert.equal(queries, 1);
  clock = 30001;
  await load(now);
  assert.equal(queries, 2);
  saved = {
    ...saved,
    revision: 2,
    records: [{ ...saved.records[0], amountKrw: 9000 }],
  };
  assert.equal((await load(now)).totalChargedKrw, 9000);
  assert.equal(queries, 3);
});
test("atomic persisted compare and swap admits exactly one simultaneous update across store instances", async () => {
  const vm = require("node:vm"),
    fs = require("node:fs"),
    path = require("node:path");
  let row = {
    label: SETTING_KEY,
    value: JSON.stringify({ revision: 1, records: [] }),
  };
  const table = {
    findUnique: async () => ({ ...row }),
    updateMany: async ({ where, data }) => {
      if (row.value !== where.value) return { count: 0 };
      row = { ...row, ...data };
      return { count: 1 };
    },
  };
  const module = { exports: {} };
  vm.runInNewContext(
    fs.readFileSync(
      path.join(__dirname, "../../utils/geminiSettings.js"),
      "utf8"
    ),
    { module, Date, require: () => ({ system_settings: table }) }
  );
  const cas = module.exports.compareAndSwapSetting;
  const results = await Promise.all([
    cas(SETTING_KEY, 1, { revision: 2, records: [{ id: "a" }] }),
    cas(SETTING_KEY, 1, { revision: 2, records: [{ id: "b" }] }),
  ]);
  assert.deepEqual(results.sort(), [false, true]);
  assert.equal(JSON.parse(row.value).records.length, 1);
});
