const test = require("node:test");
const assert = require("node:assert/strict");
const {
  maskSensitive,
  computeUsageStats,
  periodStart,
} = require("../../../utils/schatAdmin/usageStats");

const NOW = new Date("2026-09-29T03:00:00.000Z"); // 12:00 KST
const at = (kst) => new Date(`${kst}+09:00`).toISOString();
const chat = (prompt, createdAt, user_id, response) => ({
  prompt,
  createdAt,
  user_id,
  response: JSON.stringify(response),
});
const src = (documentName, page, section) => ({ documentName, page, section });

test("patient-like numbers are masked", () => {
  assert.equal(maskSensitive("등록번호 12345678 환자"), "등록번호 *** 환자");
  assert.equal(maskSensitive("900101-1234567 확인"), "*** 확인");
  assert.equal(maskSensitive("010-1234-5678로 연락"), "***로 연락");
  assert.equal(maskSensitive("041 589 6741"), "***");
  assert.equal(
    maskSensitive("KCl 40mEq 20ml, 1000cc"),
    "KCl 40mEq 20ml, 1000cc"
  );
});

test("periods start at Korean midnight", () => {
  assert.equal(
    periodStart("today", NOW).toISOString(),
    "2026-09-28T15:00:00.000Z"
  );
  assert.equal(
    periodStart("7d", NOW).toISOString(),
    "2026-09-22T15:00:00.000Z"
  );
});

function sample() {
  const users = Array.from({ length: 7 }, (_, i) => ({
    id: i + 1,
    department_id: i < 5 ? 10 : 20,
  }));
  const departments = [
    { id: 10, name: "하병동" },
    { id: 20, name: "가병동" },
  ];
  const guide = "실무지침서.pdf";
  const chats = [
    ...[1, 2, 3, 4, 5].map((id) =>
      chat("수혈 절차", at("2026-09-29T09:10:00"), id, {
        text: "수혈 절차는 다음과 같습니다.",
        sources: [src(guide, 117, "수혈 절차"), src(guide, 117, "수혈 절차")],
        metrics: { prompt_tokens: 100, completion_tokens: 20 },
      })
    ),
    chat("등록번호 12345678 환자 수혈", at("2026-09-28T23:30:00"), 6, {
      text: "등록된 문서에서 확인되지 않습니다.",
      sources: [],
    }),
    chat("치아 미백 010-1234-5678", at("2026-09-27T14:00:00"), 7, {
      text: "관련 근거는 있으나 세부 내용은 등록된 문서에서 확인되지 않습니다.",
      sources: [src(guide, 339, null)],
    }),
    chat("오래된 질문", at("2026-06-20T10:00:00"), 1, {
      text: "x",
      sources: [],
    }),
  ];
  return {
    chats,
    users,
    departments,
    documents: [guide, "검사 및 시술.pdf"],
  };
}

test("seven usage items, without any author information", () => {
  const stats = computeUsageStats({ ...sample(), period: "7d", now: NOW });
  // (1) questions (the June question is outside the period)
  assert.equal(stats.questions.total, 7);
  assert.equal(stats.questions.daily.length, 7);
  assert.equal(stats.questions.daily.at(-1).count, 5);
  assert.equal(stats.questions.hourly[9].count, 5);
  // (2) topics counted once per question
  assert.deepEqual(stats.topics[0], {
    name: "실무지침서.pdf · 수혈 절차",
    count: 5,
  });
  // (3) cited and never-cited documents
  assert.deepEqual(stats.documents.cited[0], {
    name: "실무지침서.pdf",
    count: 6,
  });
  assert.deepEqual(stats.documents.uncited, ["검사 및 시술.pdf"]);
  // (4) no evidence at all  (5) evidence found but "not found" answer
  assert.deepEqual(stats.searchFailures.items, [
    { question: "등록번호 *** 환자 수혈", date: "2026-09-28" },
  ]);
  assert.deepEqual(stats.notFoundAnswers.items, [
    { question: "치아 미백 ***", date: "2026-09-27" },
  ]);
  // (6) alphabetical, departments with fewer than 5 users hidden
  assert.deepEqual(stats.departments, [
    { name: "가병동", hidden: true },
    { name: "하병동", hidden: false, questions: 5 },
  ]);
  // (7) stored tokens only
  assert.deepEqual(stats.aiUsage, {
    questions: 7,
    chatsWithTokens: 5,
    promptTokens: 500,
    completionTokens: 100,
  });
  // no user identifiers anywhere in the response
  assert.doesNotMatch(
    JSON.stringify(stats),
    /user_id|username|employee|display_name/
  );
});

test("question text older than 90 days is never listed", () => {
  const stats = computeUsageStats({
    ...sample(),
    period: "90d",
    now: new Date("2026-09-10T03:00:00.000Z"),
  });
  const all = [...stats.searchFailures.items, ...stats.notFoundAnswers.items];
  assert.equal(
    all.some((item) => item.question === "오래된 질문"),
    true
  );
  const later = computeUsageStats({
    ...sample(),
    period: "90d",
    now: new Date("2026-09-29T03:00:00.000Z"),
  });
  assert.equal(
    [...later.searchFailures.items].some((i) => i.question === "오래된 질문"),
    false
  );
});
