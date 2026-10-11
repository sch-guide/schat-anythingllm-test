// Standard chat estimate only. Price date and every activity day use KST.
// Verified 2026-10-11: https://ai.google.dev/gemini-api/docs/pricing
const KRW_PER_USD = 1400;
const PRICE_VERIFIED = "2026-10-11";
const KST_OFFSET = 9 * 3600000;
const DAY = 86400000;
const UNKNOWN_MODEL = "이 모델은 요금표가 없어 계산할 수 없어요.";
const MISSING_USAGE =
  "과거 기록이나 확인되지 않은 사용량이 있어 계산할 수 없어요.";
const count = (n) => Number.isSafeInteger(n) && n >= 0;
const kstDay = (value) =>
  new Date(new Date(value).getTime() + KST_OFFSET).toISOString().slice(0, 10);
const kstMidnight = (day) => new Date(`${day}T00:00:00+09:00`);
const modelName = (model) =>
  typeof model === "string" ? model.replace(/^models\//, "") : "";

// Store only counts, never response text or the entire provider payload.
// Compatible completion details are a subset of completion, not additive.
function normalizeGeminiUsage(usage, model, timestamp = new Date()) {
  const u = usage && typeof usage === "object" ? usage : {};
  const native = Object.hasOwn(u, "promptTokenCount");
  const raw = native
    ? {
        promptTokenCount: u.promptTokenCount,
        candidatesTokenCount: u.candidatesTokenCount,
        thoughtsTokenCount: u.thoughtsTokenCount,
        totalTokenCount: u.totalTokenCount,
      }
    : {
        prompt_tokens: u.prompt_tokens,
        completion_tokens: u.completion_tokens,
        total_tokens: u.total_tokens,
        ...(u.completion_tokens_details && {
          completion_tokens_details: {
            reasoning_tokens: u.completion_tokens_details.reasoning_tokens,
          },
        }),
      };
  const result = {
    source: native ? "gemini-native-v1" : "gemini-openai-compatible-v1",
    model: modelName(model),
    timestamp: new Date(timestamp).toISOString(),
    raw,
    complete: false,
  };
  let inputTokens, outputTokens;
  if (native) {
    if (
      ![u.promptTokenCount, u.candidatesTokenCount, u.thoughtsTokenCount].every(
        count
      )
    )
      return result;
    inputTokens = u.promptTokenCount;
    outputTokens = u.candidatesTokenCount + u.thoughtsTokenCount;
    if (!count(outputTokens)) return result;
    if (
      u.totalTokenCount !== undefined &&
      (!count(u.totalTokenCount) ||
        u.totalTokenCount < inputTokens + outputTokens)
    )
      return result;
  } else {
    if (![u.prompt_tokens, u.completion_tokens].every(count)) return result;
    const reasoning = u.completion_tokens_details?.reasoning_tokens;
    if (
      reasoning !== undefined &&
      (!count(reasoning) || reasoning > u.completion_tokens)
    )
      return result;
    inputTokens = u.prompt_tokens;
    if (u.total_tokens !== undefined) {
      if (
        !count(u.total_tokens) ||
        u.total_tokens < inputTokens + u.completion_tokens
      )
        return result;
      outputTokens = u.total_tokens - inputTokens;
    } else if (reasoning !== undefined) {
      // OpenAI compatible completion_tokens includes reasoning_tokens.
      outputTokens = u.completion_tokens;
    } else return result;
  }
  return { ...result, complete: true, inputTokens, outputTokens };
}

function estimateChatCost(rows = []) {
  let cost = 0,
    chargedQuestions = 0,
    missingChats = 0;
  const unknownModels = new Set(),
    models = new Set();
  for (const row of rows) {
    let metrics;
    try {
      metrics = (
        typeof row.response === "string"
          ? JSON.parse(row.response)
          : row.response
      )?.metrics;
    } catch {}
    if (metrics?.answerCacheHit === true) continue;
    chargedQuestions++;
    const billing = metrics?.geminiBilling;
    if (
      billing?.version !== 1 ||
      !Array.isArray(billing.calls) ||
      !billing.calls.length
    ) {
      const historicalModel = modelName(metrics?.model);
      if (historicalModel) {
        models.add(historicalModel);
        if (historicalModel !== "gemini-3.8-flash")
          unknownModels.add(historicalModel);
      }
      missingChats++;
      continue;
    }
    let missing = false;
    for (const call of billing.calls) {
      const model = modelName(call?.model);
      models.add(model);
      if (model !== "gemini-3.8-flash") {
        unknownModels.add(model);
        missing = true;
        continue;
      }
      // Re-derive from preserved raw values; never trust normalized totals alone.
      if (
        !["gemini-native-v1", "gemini-openai-compatible-v1"].includes(
          call?.source
        ) ||
        !Number.isFinite(new Date(call?.timestamp).getTime())
      ) {
        missing = true;
        continue;
      }
      const usage = normalizeGeminiUsage(call.raw, model, call.timestamp);
      if (!call.complete || !usage.complete) {
        missing = true;
        continue;
      }
      const multiplier = kstDay(call.timestamp) >= "2027-01-01" ? 2 : 1;
      cost +=
        ((usage.inputTokens * 0.75 + usage.outputTokens * 3.75) / 1e6) *
        KRW_PER_USD *
        multiplier;
    }
    if (missing) missingChats++;
  }
  const available = rows.length > 0 && !missingChats && Number.isFinite(cost);
  return {
    estimatedKrw: available ? cost : null,
    chargedQuestions,
    missingChats,
    models: [...models].sort(),
    unknownModels: [...unknownModels].sort(),
    reason: unknownModels.size
      ? UNKNOWN_MODEL
      : available
        ? null
        : MISSING_USAGE,
    priceVerified: PRICE_VERIFIED,
  };
}

function summarizeFees(rows, records, now = new Date()) {
  const totalChargedKrw = records.reduce((sum, r) => sum + r.amountKrw, 0);
  const firstDate = records.map((r) => r.date).sort()[0];
  const since = firstDate ? kstMidnight(firstDate) : null;
  const until = new Date(now.getTime() + 1);
  const selected = since
    ? rows.filter(
        (r) => new Date(r.createdAt) >= since && new Date(r.createdAt) < until
      )
    : [];
  const estimate = estimateChatCost(selected);
  const base = {
    ...estimate,
    totalChargedKrw,
    since: since?.toISOString() || null,
    until: until.toISOString(),
    remainingKrw: null,
    percent: null,
    remainingPercent: null,
    level: "unavailable",
    questionsRemaining: null,
    daysRemaining: null,
    forecastReady: false,
  };
  if (!records.length)
    return {
      ...base,
      estimatedKrw: null,
      reason: "충전한 금액과 날짜를 먼저 추가해 주세요.",
    };
  if (estimate.estimatedKrw === null) return base;
  const remainingKrw = Math.max(0, totalChargedKrw - estimate.estimatedKrw);
  const remainingPercent = (remainingKrw / totalChargedKrw) * 100;
  const recentSince = new Date(kstMidnight(kstDay(now)).getTime() - 6 * DAY);
  const recent = selected.filter((r) => new Date(r.createdAt) >= recentSince);
  const recentEstimate = estimateChatCost(recent);
  const activity = new Set(
    recent
      .filter((r) => {
        try {
          return JSON.parse(r.response)?.metrics?.answerCacheHit !== true;
        } catch {
          return true;
        }
      })
      .map((r) => kstDay(r.createdAt))
  );
  const forecastReady =
    activity.size >= 3 &&
    recentEstimate.chargedQuestions >= 10 &&
    recentEstimate.estimatedKrw > 0;
  return {
    ...base,
    remainingKrw,
    percent: (estimate.estimatedKrw / totalChargedKrw) * 100,
    remainingPercent,
    level:
      remainingKrw === 0
        ? "high"
        : remainingPercent < 20
          ? "warning"
          : "normal",
    forecastReady,
    questionsRemaining: forecastReady
      ? remainingKrw /
        (recentEstimate.estimatedKrw / recentEstimate.chargedQuestions)
      : null,
    daysRemaining: forecastReady
      ? remainingKrw / (recentEstimate.estimatedKrw / 7)
      : null,
  };
}

module.exports = {
  KRW_PER_USD,
  PRICE_VERIFIED,
  kstDay,
  kstMidnight,
  normalizeGeminiUsage,
  estimateChatCost,
  summarizeFees,
};
