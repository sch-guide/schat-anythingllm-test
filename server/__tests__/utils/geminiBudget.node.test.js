const test = require("node:test");
const assert = require("node:assert/strict");
const {
  estimateBudget,
  validateConfig,
  monthRange,
} = require("../../utils/geminiBudget");
const config = {
  monthlyBudgetKrw: 100000,
  rates: [{ model: "gemini-test", inputKrw: 1000, outputKrw: 2000 }],
};
const row = (tokens, extra = {}) => ({
  response: JSON.stringify({
    metrics: {
      model: "gemini-test",
      provider: "GeminiLLM",
      prompt_tokens: tokens,
      completion_tokens: 0,
      ...extra,
    },
  }),
});
for (const [tokens, percent, level] of [
  [79000000, 79, "normal"],
  [80000000, 80, "warning"],
  [95000000, 95, "high"],
]) {
  test(`measured chat usage produces ${percent}% and ${level}`, () => {
    const result = estimateBudget([row(tokens)], config);
    assert.equal(result.percent, percent);
    assert.equal(result.level, level);
    assert.equal(result.estimatedKrw, percent * 1000);
  });
}
test("missing records, tokens, model or rates are not reported as zero", () => {
  for (const rows of [
    [],
    [row(null)],
    [row(1, { completion_tokens: undefined })],
    [row(1, { model: "unknown" })],
    [{ response: "bad" }],
  ]) {
    const result = estimateBudget(rows, config);
    assert.equal(result.percent, null);
    assert.equal(result.estimatedKrw, null);
  }
  assert.equal(estimateBudget([row(1)], {}).percent, null);
});
test("negative, non-finite and default-zero input tokens are not measurable usage", () => {
  assert.equal(estimateBudget([row(-1)], config).percent, null);
  assert.equal(estimateBudget([row("100")], config).percent, null);
  assert.equal(estimateBudget([row(0)], config).percent, null);
  assert.equal(
    estimateBudget([row(0, { completion_tokens: 1 })], config).estimatedKrw,
    null
  );
});
test("output tokens use separate rate and no token records are modified", () => {
  const rows = [row(1000000, { completion_tokens: 2000000 })];
  const before = JSON.stringify(rows);
  assert.equal(estimateBudget(rows, config).estimatedKrw, 5000);
  assert.equal(JSON.stringify(rows), before);
});
test("bad or duplicate model settings are rejected; no coercion of empty fields", () => {
  for (const bad of [
    {},
    { ...config, monthlyBudgetKrw: 0 },
    {
      ...config,
      rates: [{ model: "gemini-test", inputKrw: "", outputKrw: 2 }],
    },
    { ...config, rates: [config.rates[0], config.rates[0]] },
  ])
    assert.throws(() => validateConfig(bad));
});
test("monthly accounting follows Korean time, not server timezone", () => {
  const r = monthRange(new Date("2026-10-31T15:00:00Z"));
  assert.equal(r.since.toISOString(), "2026-10-31T15:00:00.000Z");
  assert.equal(r.until.toISOString(), "2026-11-30T15:00:00.000Z");
});

test("a confirmed zero-token cache replay does not invalidate measured Gemini usage", () => {
  const cached = { response: JSON.stringify({ metrics: {
    answerCacheHit: true, prompt_tokens: 0, completion_tokens: 0, total_tokens: 0,
  } }) };
  const result = estimateBudget([row(80000000), cached], config);
  assert.equal(result.percent, 80);
  assert.equal(result.missingChats, 0);
  assert.equal(result.recordedChats, 1);
  assert.equal(estimateBudget([cached], config).percent, null);
  const suspicious = { response: JSON.stringify({ metrics: {
    answerCacheHit: true, prompt_tokens: 1, completion_tokens: 0,
  } }) };
  assert.equal(estimateBudget([row(80000000), suspicious], config).percent, null);
});
