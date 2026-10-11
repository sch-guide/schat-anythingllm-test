const test = require("node:test");
const assert = require("node:assert/strict");
const fees = require("../../utils/aiUsageFees");
const at = "2026-10-11T03:00:00Z";
const call = (usage, model = "gemini-3.8-flash", timestamp = at) =>
  fees.normalizeGeminiUsage(usage, model, timestamp);
const row = (usage, date = at, model) => ({
  createdAt: new Date(date),
  response: JSON.stringify({
    metrics: {
      geminiBilling: { version: 1, calls: [call(usage, model, date)] },
    },
  }),
});
const measured = {
  prompt_tokens: 1000000,
  completion_tokens: 100000,
  total_tokens: 1100000,
};
test("price changes on KST 2027 midnight, and only exact model names have prices", () => {
  assert.equal(fees.estimateChatCost([row(measured)]).estimatedKrw, 1575);
  assert.equal(
    fees.estimateChatCost([row(measured, "2026-12-31T15:00:00Z")]).estimatedKrw,
    3150
  );
  assert.equal(
    fees.estimateChatCost([row(measured, at, "models/gemini-3.8-flash")])
      .estimatedKrw,
    1575
  );
  assert.equal(
    fees.estimateChatCost([row(measured, at, "gemini-3.8-flash-latest")])
      .estimatedKrw,
    null
  );
});
test("thinking is distinct for native usage but inclusive in compatible total and completion details", () => {
  assert.equal(
    call({
      promptTokenCount: 100,
      candidatesTokenCount: 20,
      thoughtsTokenCount: 30,
    }).outputTokens,
    50
  );
  assert.equal(
    call({
      prompt_tokens: 100,
      completion_tokens: 50,
      total_tokens: 150,
      completion_tokens_details: { reasoning_tokens: 30 },
    }).outputTokens,
    50
  );
  assert.equal(
    call({ prompt_tokens: 100, completion_tokens: 20, total_tokens: 150 })
      .outputTokens,
    50
  );
  assert.equal(
    call({
      prompt_tokens: 100,
      completion_tokens: 50,
      completion_tokens_details: { reasoning_tokens: 30 },
    }).outputTokens,
    50
  );
});
test("invalid, missing, historical and unknown charged usage cannot silently become zero", () => {
  for (const usage of [
    null,
    {},
    { prompt_tokens: 1, completion_tokens: 2 },
    { prompt_tokens: 1, completion_tokens: 2, total_tokens: 2 },
    { prompt_tokens: -1, completion_tokens: 2, total_tokens: 3 },
    { prompt_tokens: 1.5, completion_tokens: 2, total_tokens: 4 },
    { promptTokenCount: 1, candidatesTokenCount: 2 },
  ])
    assert.equal(call(usage).complete, false);
  assert.equal(
    fees.estimateChatCost([
      {
        createdAt: new Date(at),
        response: JSON.stringify({ metrics: measured }),
      },
    ]).estimatedKrw,
    null
  );
  assert.equal(
    fees.estimateChatCost([row(measured, at, "gpt-4o")]).reason,
    "이 모델은 요금표가 없어 계산할 수 없어요."
  );
  assert.equal(
    fees.estimateChatCost([
      {
        response: JSON.stringify({
          metrics: { ...measured, model: "gemini-3.5-flash-lite" },
        }),
      },
    ]).reason,
    "이 모델은 요금표가 없어 계산할 수 없어요."
  );
  const cached = {
    response: JSON.stringify({ metrics: { answerCacheHit: true } }),
  };
  assert.equal(fees.estimateChatCost([cached]).estimatedKrw, 0);
  assert.equal(fees.estimateChatCost([cached]).chargedQuestions, 0);
});
test("agent subcalls preserve each price date and one missing call invalidates the question", () => {
  const metrics = {
    geminiBilling: {
      version: 1,
      calls: [
        call(measured),
        call(measured, undefined, "2027-01-01T00:00:00Z"),
      ],
    },
  };
  assert.equal(
    fees.estimateChatCost([{ response: JSON.stringify({ metrics }) }])
      .estimatedKrw,
    4725
  );
  metrics.geminiBilling.calls.push(call(null));
  assert.equal(
    fees.estimateChatCost([{ response: JSON.stringify({ metrics }) }])
      .estimatedKrw,
    null
  );
});
test("recharges sum, use earliest KST midnight, and warnings use strict raw twenty percent", () => {
  const records = [
    { id: "a", amountKrw: 1000, date: "2026-10-10" },
    { id: "b", amountKrw: 968.75, date: "2026-10-11" },
  ];
  const budget = fees.summarizeFees(
    [row(measured), row(measured, "2026-10-09T14:59:59Z")],
    records,
    new Date(at)
  );
  assert.equal(budget.totalChargedKrw, 1968.75);
  assert.equal(budget.estimatedKrw, 1575);
  assert.equal(budget.remainingKrw, 393.75);
  assert.equal(budget.level, "normal");
  assert.equal(
    fees.summarizeFees(
      [row(measured)],
      [{ ...records[0], amountKrw: 1968 }],
      new Date(at)
    ).level,
    "warning"
  );
  assert.equal(
    fees.summarizeFees([row(measured)], [records[0]], new Date(at)).level,
    "high"
  );
  assert.equal(fees.summarizeFees([], [], new Date(at)).estimatedKrw, null);
  assert.equal(
    fees.summarizeFees([], records, new Date(at)).estimatedKrw,
    null
  );
  const cacheOnly = [
    {
      createdAt: new Date(at),
      response: JSON.stringify({ metrics: { answerCacheHit: true } }),
    },
  ];
  assert.equal(
    fees.summarizeFees(cacheOnly, records, new Date(at)).estimatedKrw,
    0
  );
});
test("forecast needs ten charged questions over three active KST days and avoids zero division", () => {
  const rows = Array.from({ length: 10 }, (_, i) =>
    row(measured, `2026-10-${String(9 + (i % 3)).padStart(2, "0")}T00:00:00Z`)
  );
  const records = [{ id: "a", amountKrw: 31500, date: "2026-10-01" }];
  const result = fees.summarizeFees(rows, records, new Date(at));
  assert.equal(result.questionsRemaining, 10);
  assert.equal(result.daysRemaining, 7);
  assert.equal(
    fees.summarizeFees(rows.slice(0, 9), records, new Date(at))
      .questionsRemaining,
    null
  );
  const zero = rows.map((r) =>
    row(
      { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
      r.createdAt.toISOString()
    )
  );
  assert.equal(
    fees.summarizeFees(zero, records, new Date(at)).daysRemaining,
    null
  );
});
test("usage statistics apply the same calculator and retain small department suppression", () => {
  const { computeUsageStats } = require("../../utils/schatAdmin/usageStats");
  const chats = [row(measured)];
  chats[0].user_id = 1;
  const stats = computeUsageStats({ chats, now: new Date(at) });
  assert.equal(stats.aiUsage.estimatedCost.estimatedKrw, 1575);
  const filtered = computeUsageStats({
    chats,
    now: new Date(at),
    users: [{ id: 1, department_id: 1 }],
    departments: [{ id: 1, name: "테스트" }],
    departmentIds: [1],
  });
  assert.equal(filtered.suppressed, true);
  assert.equal(filtered.aiUsage, undefined);
});
