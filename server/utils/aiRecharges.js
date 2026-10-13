const { randomUUID } = require("node:crypto");
const {
  kstDay,
  kstMidnight,
  summarizeFees,
  monthEstimate,
} = require("./aiUsageFees");
const SETTING_KEY = "schat_ai_recharges";
const fail = (status, message) => {
  const error = Error(message);
  error.status = status;
  throw error;
};

function createRechargeStore({
  readSetting,
  compareAndSwapSetting,
  now = () => new Date(),
  id = randomUUID,
}) {
  async function read() {
    const value = await readSetting(SETTING_KEY);
    if (value === null || value === undefined)
      return { revision: 0, records: [] };
    if (
      !Number.isSafeInteger(value.revision) ||
      value.revision < 0 ||
      !Array.isArray(value.records) ||
      value.records.length > 1000
    )
      fail(503, "충전 기록을 불러오지 못했어요.");
    return value;
  }
  async function mutate(body, action = "create") {
    if (!body || !Number.isSafeInteger(body.revision) || body.revision < 0)
      fail(400, "충전 기록을 다시 불러온 뒤 저장해 주세요.");
    let clean;
    if (action !== "delete") {
      const { amountKrw, date } = body;
      if (
        !Number.isFinite(amountKrw) ||
        amountKrw <= 0 ||
        amountKrw > 1e12 ||
        typeof date !== "string" ||
        !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
        date < "0001-01-01" ||
        !Number.isFinite(kstMidnight(date).getTime()) ||
        kstDay(kstMidnight(date)) !== date ||
        date > kstDay(now())
      )
        fail(
          400,
          "충전 금액은 양수로, 날짜는 오늘까지의 올바른 날짜로 입력해 주세요."
        );
      clean = { amountKrw, date };
    }
    const current = await read();
    if (current.revision !== body.revision)
      fail(
        409,
        "다른 관리자가 충전 기록을 바꿨어요. 새로고침한 뒤 다시 저장해 주세요."
      );
    const records = current.records.map((r) => ({ ...r }));
    if (action === "create") {
      if (records.length >= 1000)
        fail(400, "충전 기록은 최대 1,000개까지 저장할 수 있어요.");
      records.push({ id: id(), ...clean });
    } else {
      const index = records.findIndex((r) => r.id === body.id);
      if (index < 0) fail(404, "해당 충전 기록을 찾을 수 없어요.");
      if (action === "delete") records.splice(index, 1);
      else if (action === "update")
        records[index] = { id: records[index].id, ...clean };
      else fail(400, "충전 기록을 저장하지 못했어요.");
    }
    const next = { revision: current.revision + 1, records };
    if (!(await compareAndSwapSetting(SETTING_KEY, current.revision, next)))
      fail(
        409,
        "다른 관리자가 충전 기록을 바꿨어요. 새로고침한 뒤 다시 저장해 주세요."
      );
    return next;
  }
  return { read, mutate };
}

let store;
function rechargeStore() {
  return (store ||= createRechargeStore(require("./geminiSettings")));
}
function createFeesLoader({ read, readRows, clock = Date.now }) {
  let cache;
  const pending = new Map();
  return async function load(now = new Date()) {
    const saved = await read();
    const key = `${saved.revision}:${kstDay(now)}`;
    if (cache?.key === key && clock() - cache.at < 30000) return cache.value;
    if (pending.has(key)) return pending.get(key);
    const work = (async () => {
      const firstDate = saved.records.map((r) => r.date).sort()[0];
      const monthStart = `${kstDay(now).slice(0, 7)}-01`;
      const since = firstDate && firstDate < monthStart ? firstDate : monthStart;
      const rows = await readRows(kstMidnight(since), now);
      const value = {
        ...summarizeFees(rows, saved.records, now),
        month: monthEstimate(rows, now),
        ...saved,
      };
      cache = { key, at: clock(), value };
      return value;
    })();
    pending.set(key, work);
    try {
      return await work;
    } finally {
      pending.delete(key);
    }
  };
}
const loadFees = createFeesLoader({
  read: () => rechargeStore().read(),
  readRows: (since, now) =>
    require("./prisma").workspace_chats.findMany({
      where: { createdAt: { gte: since, lte: now } },
      select: { response: true, createdAt: true },
    }),
});
module.exports = {
  SETTING_KEY,
  createRechargeStore,
  rechargeStore,
  createFeesLoader,
  loadFees,
};
