// Standard chat estimate only. Price date and every activity day use KST.
// Verified 2026-10-11: https://ai.google.dev/gemini-api/docs/pricing
const KRW_PER_USD = 1400;
const PRICE_VERIFIED = "2026-10-11";
const KST_OFFSET = 9 * 3600000;
const DAY = 86400000;
const UNKNOWN_MODEL = "이 모델은 요금표가 없어 계산할 수 없어요.";
const MISSING_USAGE =
  "과거 기록이나 확인되지 않은 사용량이 있어 계산할 수 없어요.";
const NO_RECORDS = "아직 계산할 채팅 기록이 없어요.";

// 모델별 단가(USD, 100만 토큰당). 확인한 공식 단가만 넣음. 새 모델은 단가를
// 확인한 뒤 여기 한 곳에만 추가하고, 없으면 "단가 정보 없음"으로 제외됨.
// fromKst: 그 한국 날짜부터 적용되는 단가(늦은 날짜가 우선).
const MODEL_PRICING = {
  "gemini-3.8-flash": {
    verified: PRICE_VERIFIED,
    periods: [
      { fromKst: "0000-01-01", inputUsd: 0.75, outputUsd: 3.75 },
      { fromKst: "2027-01-01", inputUsd: 1.5, outputUsd: 7.5 },
    ],
  },
  // 2026-10-14 같은 공식 요금표에서 확인. 인상 예고 없음.
  "gemini-3.5-flash-lite": {
    verified: "2026-10-14",
    periods: [{ fromKst: "0000-01-01", inputUsd: 0.3, outputUsd: 2.5 }],
  },
};
function priceFor(model, timestamp) {
  const table = MODEL_PRICING[model];
  if (!table) return null;
  const day = kstDay(timestamp);
  return (
    table.periods.filter((p) => p.fromKst <= day).sort((a, b) =>
      b.fromKst.localeCompare(a.fromKst)
    )[0] || null
  );
}
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

// 채팅마다 그 기록에 저장된 모델의 단가로 계산함. 사용량 기록이 없거나
// 단가 정보가 없는 채팅은 그 채팅만 빼고(일부 기록 제외), 나머지는 계산함.
function estimateChatCost(rows = []) {
  let cost = 0,
    chargedQuestions = 0,
    calculatedChats = 0,
    noUsageChats = 0,
    unpricedChats = 0;
  const unknownModels = new Set(),
    models = new Set(),
    byModel = new Map();
  const addModel = (model, krw) => {
    const entry = byModel.get(model) || { model, krw: 0, calls: 0 };
    entry.krw += krw;
    entry.calls += 1;
    byModel.set(model, entry);
  };
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
        if (!MODEL_PRICING[historicalModel]) unknownModels.add(historicalModel);
      }
      noUsageChats++;
      continue;
    }
    let chatCost = 0,
      noUsage = false,
      unpriced = false;
    const chatCalls = [];
    for (const call of billing.calls) {
      const model = modelName(call?.model);
      models.add(model);
      // Re-derive from preserved raw values; never trust normalized totals alone.
      if (
        !["gemini-native-v1", "gemini-openai-compatible-v1"].includes(
          call?.source
        ) ||
        !Number.isFinite(new Date(call?.timestamp).getTime())
      ) {
        noUsage = true;
        continue;
      }
      const price = priceFor(model, call.timestamp);
      if (!price) {
        unknownModels.add(model);
        unpriced = true;
        continue;
      }
      const usage = normalizeGeminiUsage(call.raw, model, call.timestamp);
      if (!call.complete || !usage.complete) {
        noUsage = true;
        continue;
      }
      const krw =
        ((usage.inputTokens * price.inputUsd +
          usage.outputTokens * price.outputUsd) /
          1e6) *
        KRW_PER_USD;
      chatCost += krw;
      chatCalls.push([model, krw]);
    }
    if (unpriced) unpricedChats++;
    else if (noUsage) noUsageChats++;
    else {
      calculatedChats++;
      cost += chatCost;
      for (const [model, krw] of chatCalls) addModel(model, krw);
    }
  }
  const excludedChats = noUsageChats + unpricedChats;
  const available =
    rows.length > 0 &&
    Number.isFinite(cost) &&
    (calculatedChats > 0 || excludedChats === 0);
  const partial = available && excludedChats > 0;
  let reason = null;
  if (!rows.length) reason = NO_RECORDS;
  else if (!available)
    reason = unknownModels.size ? UNKNOWN_MODEL : MISSING_USAGE;
  else if (partial)
    reason = `일부 기록 제외 ${excludedChats}건: ${[
      noUsageChats && `사용량 기록 없는 과거 기록 ${noUsageChats}건`,
      unpricedChats && `단가 정보 없음 ${unpricedChats}건`,
    ]
      .filter(Boolean)
      .join(", ")}`;
  return {
    estimatedKrw: available ? cost : null,
    chargedQuestions,
    calculatedChats,
    excludedChats,
    noUsageChats,
    unpricedChats,
    // 예전 이름 유지(다른 화면·검사가 사용).
    missingChats: excludedChats,
    partial,
    models: [...models].sort(),
    unknownModels: [...unknownModels].sort(),
    byModel: [...byModel.values()].sort((a, b) =>
      a.model.localeCompare(b.model)
    ),
    reason,
    priceVerified: PRICE_VERIFIED,
  };
}

// 이번 달(한국 시간) 기록된 채팅 기준 예상 비용.
function monthEstimate(rows, now = new Date()) {
  const since = kstMidnight(`${kstDay(now).slice(0, 7)}-01`);
  const until = new Date(now.getTime() + 1);
  const selected = rows.filter(
    (r) => new Date(r.createdAt) >= since && new Date(r.createdAt) < until
  );
  return { ...estimateChatCost(selected), since: since.toISOString() };
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
  MODEL_PRICING,
  priceFor,
  monthEstimate,
  kstDay,
  kstMidnight,
  normalizeGeminiUsage,
  estimateChatCost,
  summarizeFees,
};
