// Estimates only saved chat metrics. No Gemini calls and no enforcement.
function validateConfig(config) {
  if (
    !config ||
    !Number.isFinite(config.monthlyBudgetKrw) ||
    config.monthlyBudgetKrw <= 0 ||
    config.monthlyBudgetKrw > 1e12 ||
    !Array.isArray(config.rates) ||
    !config.rates.length ||
    config.rates.length > 30
  )
    throw Error("invalid_budget");
  const models = new Set();
  const rates = config.rates.map((rate) => {
    if (
      !rate ||
      typeof rate.model !== "string" ||
      !/^gemini-[a-zA-Z0-9._-]{1,100}$/.test(rate.model) ||
      models.has(rate.model) ||
      ![rate.inputKrw, rate.outputKrw].every(
        (n) => Number.isFinite(n) && n > 0 && n <= 1e9
      )
    )
      throw Error("invalid_rates");
    models.add(rate.model);
    return {
      model: rate.model,
      inputKrw: rate.inputKrw,
      outputKrw: rate.outputKrw,
    };
  });
  return { monthlyBudgetKrw: config.monthlyBudgetKrw, rates };
}
function estimateBudget(rows, config) {
  const result = {
    estimatedKrw: null,
    percent: null,
    remainingPercent: null,
    level: "unavailable",
    reason: null,
    recordedChats: 0,
    missingChats: 0,
    models: [],
  };
  const metrics = [];
  for (const row of rows) {
    let m;
    try {
      m = JSON.parse(row.response).metrics;
    } catch {}
    // Cache replays make no provider call. Do not classify their deliberate
    // zero usage as missing telemetry; retain fail-closed handling otherwise.
    if (m?.answerCacheHit === true && m.prompt_tokens === 0 &&
        m.completion_tokens === 0 && m.total_tokens === 0) continue;
    // Existing stream metrics can use input=0 plus output chunk count when no
    // upstream usage was received. Never mistake that fallback for measured cost.
    if (
      !m ||
      !Number.isSafeInteger(m.prompt_tokens) ||
      m.prompt_tokens <= 0 ||
      !Number.isSafeInteger(m.completion_tokens) ||
      m.completion_tokens < 0 ||
      typeof m.model !== "string" ||
      !/^gemini-/.test(m.model)
    ) {
      result.missingChats++;
      continue;
    }
    metrics.push(m);
  }
  result.recordedChats = metrics.length;
  result.models = [...new Set(metrics.map((m) => m.model))].sort();
  try {
    config = validateConfig(config);
  } catch {
    return { ...result, reason: "예산 또는 모델별 예상 단가를 설정해 주세요." };
  }
  if (!rows.length || !metrics.length || result.missingChats)
    return {
      ...result,
      reason: "채팅 사용량 또는 모델 기록이 부족하여 계산할 수 없습니다.",
    };
  const rates = new Map(config.rates.map((r) => [r.model, r]));
  let cost = 0;
  for (const m of metrics) {
    const r = rates.get(m.model);
    if (!r) return { ...result, reason: "기록된 모델의 예상 단가가 없습니다." };
    cost +=
      (m.prompt_tokens * r.inputKrw + m.completion_tokens * r.outputKrw) / 1e6;
  }
  const percent = (cost / config.monthlyBudgetKrw) * 100;
  if (!Number.isFinite(percent) || !Number.isFinite(cost))
    return { ...result, reason: "계산 범위를 초과했습니다." };
  return {
    ...result,
    estimatedKrw: cost,
    percent,
    remainingPercent: Math.max(0, 100 - percent),
    level: percent >= 95 ? "high" : percent >= 80 ? "warning" : "normal",
  };
}
function monthRange(now = new Date()) {
  const kst = new Date(now.getTime() + 9 * 3600000);
  return {
    since: new Date(
      Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth(), 1) - 9 * 3600000
    ),
    until: new Date(
      Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth() + 1, 1) - 9 * 3600000
    ),
  };
}
let cache = null;
async function loadBudget(now = new Date()) {
  const { since, until } = monthRange(now);
  if (
    cache &&
    cache.month === since.toISOString() &&
    Date.now() - cache.at < 30000
  )
    return cache.value;
  const { readSetting } = require("./geminiSettings");
  const config = await readSetting("schat_gemini_budget");
  const rows = await require("./prisma").workspace_chats.findMany({
    where: { createdAt: { gte: since, lt: until } },
    select: { response: true },
  });
  const value = {
    config: config || { monthlyBudgetKrw: null, rates: [] },
    ...estimateBudget(rows, config),
    since: since.toISOString(),
    until: until.toISOString(),
  };
  cache = { month: since.toISOString(), at: Date.now(), value };
  return value;
}
async function saveBudget(config) {
  const clean = validateConfig(config);
  await require("./geminiSettings").writeSetting("schat_gemini_budget", clean);
  cache = null;
  return clean;
}
module.exports = {
  validateConfig,
  estimateBudget,
  monthRange,
  loadBudget,
  saveBudget,
};
