// Single Node process, persistent local observation. This is not Google's
// authoritative project usage, remaining credit, or an admission restriction.
function quotaDay(date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(date);
  const get = type => parts.find(part => part.type === type).value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function createDailyUsage(storage, now = () => new Date()) {
  let state, loading, writes = Promise.resolve(), healthy = true;
  async function load() {
    if (state) return;
    if (!loading) loading = (async () => {
    const saved = await storage.read();
    if (saved && (!/^\d{4}-\d{2}-\d{2}$/.test(saved.day) ||
      !Number.isFinite(Date.parse(saved.startedAt)) || !saved.counts ||
      Object.values(saved.counts).some(n => !Number.isSafeInteger(n) || n < 0)))
      throw Error("Invalid daily usage record");
    state = saved || { day: quotaDay(now()), startedAt: now().toISOString(), counts: {} };
    })().catch(error => { loading = null; throw error; });
    return loading;
  }
  function record(model) {
    const attemptedDay = quotaDay(now());
    const job = writes.then(async () => {
      try {
        await load();
        const day = attemptedDay;
        const counts = day === state.day ? {...state.counts} : {};
        const count = (Object.hasOwn(counts, model) ? counts[model] : 0) + 1;
        state = {...state, day, counts: {...counts, [model]: count}};
        await storage.write(state);
        healthy = true;
      } catch {
        healthy = false;
      }
    });
    writes = job;
    return job;
  }
  async function snapshot(model) {
    await writes;
    try { await load(); } catch { healthy = false; }
    const day = quotaDay(now());
    const count = state?.day === day && Object.hasOwn(state.counts, model) ? state.counts[model] : 0;
    return {
      model, day, available: healthy, count: healthy ? count : null,
      limit: 10000, warning: healthy && count >= 7000,
      startedAt: state?.startedAt || null, timeZone: "America/Los_Angeles",
    };
  }
  return { record, snapshot };
}

function countingFetch(send, usage) {
  return async (url, init) => {
    init?.signal?.throwIfAborted();
    try {
      const target = new URL(String(url));
      if (target.hostname === "generativelanguage.googleapis.com" &&
          target.pathname.endsWith("/chat/completions") && init?.method?.toUpperCase() === "POST") {
        const model = JSON.parse(init.body)?.model;
        if (typeof model === "string" && /^[\w.-]{1,120}$/.test(model))
          // Persist asynchronously: accounting must never queue the provider
          // behind a slow settings write. No SDK call means no increment.
          void usage.record(model).catch(() => {});
      }
    } catch { /* Telemetry must not alter the answer path. */ }
    init?.signal?.throwIfAborted();
    return send(url, init);
  };
}

const LABEL = "schat_gemini_daily_usage";
const dailyUsage = createDailyUsage({
  read: async () => {
    const row = await require("./prisma").system_settings.findUnique({where: {label: LABEL}});
    return row ? JSON.parse(row.value) : null;
  },
  write: async value => {
    const json = JSON.stringify(value);
    await require("./prisma").system_settings.upsert({
      where: {label: LABEL}, create: {label: LABEL, value: json},
      update: {value: json, lastUpdatedAt: new Date()},
    });
  },
});
module.exports = { quotaDay, createDailyUsage, countingFetch, dailyUsage };
