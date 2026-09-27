const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const core = require("../../../utils/schatQuiz/core");

// Synthetic content only.
const MC = {
  questionType: "multiple_choice",
  difficulty: "intermediate",
  topic: "가상 주제",
  question: "가상 절차에서 먼저 확인하는 것은?",
  choices: ["가", "나", "다", "라"],
  correctChoiceId: "c2",
  explanation: "근거에 따라 나를 먼저 확인합니다.",
  sourcePage: 3,
};

test("multiple choice keeps the answer as a choice id; OX has its own field", () => {
  const mc = core.validateQuestionInput(MC);
  assert.equal(mc.ok, true);
  assert.equal(mc.value.correct_choice_id, "c2");
  assert.equal(mc.value.correct_ox, null);
  assert.deepEqual(
    JSON.parse(mc.value.choices).map((c) => c.id),
    ["c1", "c2", "c3", "c4"]
  );
  const ox = core.validateQuestionInput({
    ...MC,
    questionType: "ox",
    choices: undefined,
    correctChoiceId: undefined,
    correctOx: "X",
  });
  assert.equal(ox.ok, true);
  assert.equal(ox.value.choices, null);
  assert.equal(ox.value.correct_choice_id, null);
  assert.equal(ox.value.correct_ox, "X");

  assert.equal(
    core.validateQuestionInput({ ...MC, choices: ["가", "가", "다", "라"] }).ok,
    false
  );
  assert.equal(
    core.validateQuestionInput({ ...MC, correctChoiceId: "B" }).ok,
    false
  );
  assert.equal(
    core.validateQuestionInput({ ...MC, questionType: "ox", correctOx: "B" })
      .ok,
    false
  );
});

test("shuffled display order never changes who is correct", () => {
  const q = {
    question_type: "multiple_choice",
    choices: core.validateQuestionInput(MC).value.choices,
    correct_choice_id: "c2",
  };
  for (let seed = 0; seed < 20; seed++) {
    let x = seed + 1;
    const rng = () => (x = (x * 9301 + 49297) % 233280) / 233280;
    const order = core.shuffle(["c1", "c2", "c3", "c4"], rng);
    // whatever letter "나" ends up under, choosing it is correct
    assert.equal(core.judge(q, { choiceId: "c2" }), true);
    assert.equal(
      core.judge(q, { choiceId: order.find((id) => id !== "c2") }),
      false
    );
  }
  assert.equal(core.judge(q, { choiceId: "B" }), false);
  const ox = { question_type: "ox", correct_ox: "O" };
  assert.equal(core.judge(ox, { ox: "O" }), true);
  assert.equal(core.judge(ox, { ox: "X" }), false);
  assert.equal(core.judge(ox, { choiceId: "c1" }), false);
});

test("random picking prefers questions not answered recently", () => {
  const pool = Array.from({ length: 10 }, (_, i) => ({ id: i + 1 }));
  const recent = new Set([1, 2, 3, 4, 5, 6, 7]);
  const picked = core.pickQuestions(pool, 3, recent);
  assert.deepEqual(picked.map((q) => q.id).sort(), [10, 8, 9].sort());
  // a small bank still fills the quiz with recent questions
  assert.equal(core.pickQuestions(pool, 8, recent).length, 8);
  // fewer questions than requested: only what exists
  assert.equal(core.pickQuestions(pool.slice(0, 7), 10, new Set()).length, 7);
});

test("generated items are checked against the evidence that was sent", () => {
  const evidenceByPage = new Map([
    [3, "가상 절차는 30분 이내에 나를 확인한다."],
  ]);
  const base = {
    question: "가상 절차에서 먼저 확인하는 것은?",
    choices: ["가", "나", "다", "라"],
    correctIndex: 1,
    oxAnswer: "",
    explanation: "30분 이내에 나를 확인합니다.",
    sourcePage: 3,
    evidenceQuote: "가상 절차는 30분 이내에 나를 확인한다.",
  };
  const ok = core.checkGeneratedItem(base, {
    type: "multiple_choice",
    evidenceByPage,
  });
  assert.equal(ok.correct_choice_id, "c2");
  assert.equal(ok.review_note, null);
  assert.equal(ok.source_excerpt, base.evidenceQuote);

  const drift = core.checkGeneratedItem(
    { ...base, explanation: "45분 이내에 나를 확인합니다." },
    { type: "multiple_choice", evidenceByPage }
  );
  assert.match(drift.review_note, /근거 쪽에 없는 숫자: 45/);

  for (const bad of [
    { sourcePage: 9 }, // page that was not sent
    { choices: ["가", "가", "다", "라"] },
    { choices: ["가", "나", "다"] },
    { correctIndex: 4 },
    { question: " " },
  ])
    assert.equal(
      core.checkGeneratedItem(
        { ...base, ...bad },
        { type: "multiple_choice", evidenceByPage }
      ),
      null
    );

  const ox = core.checkGeneratedItem(
    { ...base, choices: [], correctIndex: -1, oxAnswer: "O" },
    { type: "ox", evidenceByPage }
  );
  assert.equal(ox.correct_ox, "O");
  assert.equal(ox.choices, null);
  assert.equal(
    core.checkGeneratedItem(
      { ...base, oxAnswer: "" },
      { type: "ox", evidenceByPage }
    ),
    null
  );
});

test("department averages need at least five respondents; no ranking", () => {
  const attempts = [];
  let id = 1;
  for (let u = 1; u <= 5; u++)
    attempts.push({
      id: id++,
      user_id: u,
      department_name: "가상병동A",
      score: 80,
      correct_count: 8,
      total: 10,
    });
  for (let u = 6; u <= 9; u++)
    attempts.push({
      id: id++,
      user_id: u,
      department_name: "가상병동B",
      score: 100,
      correct_count: 10,
      total: 10,
    });
  const stats = core.departmentStats(attempts, new Map());
  const a = stats.find((d) => d.department === "가상병동A");
  const b = stats.find((d) => d.department === "가상병동B");
  assert.equal(a.enough, true);
  assert.equal(a.averageScore, 80);
  assert.equal(a.averageRate, 80);
  assert.equal(b.enough, false);
  assert.equal(b.averageScore, null);
  assert.equal(b.averageRate, null);
  assert.equal(b.respondents, null);
  // alphabetical, never sorted by score
  assert.deepEqual(
    stats.map((d) => d.department),
    ["가상병동A", "가상병동B"]
  );
});

test("document keys are opaque and stable", () => {
  const key = core.docKeyOf("11111111-aaaa-4aaa-8aaa-000000000001");
  assert.match(key, /^[a-f0-9]{16}$/);
  assert.equal(key, core.docKeyOf("11111111-aaaa-4aaa-8aaa-000000000001"));
  assert.equal(key.includes("1111"), false);
});

// ---- Gemini can only be reached from the admin generation routes -------------

const root = path.join(__dirname, "../../..");
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");
const requiresOf = (source) =>
  [...source.matchAll(/require\(\s*["'`]([^"'`]+)["'`]\s*\)/g)].map(
    (m) => m[1]
  );

test("staff quiz routes and the bank never load the generation service or AI", () => {
  for (const rel of [
    "endpoints/schatQuiz.js",
    "utils/schatQuiz/bank.js",
    "utils/schatQuiz/core.js",
  ]) {
    const deps = requiresOf(read(rel));
    for (const dep of deps) {
      assert.doesNotMatch(
        dep,
        /generation|AiProviders|gemini|openai|helpers/i,
        `${rel} -> ${dep}`
      );
    }
  }
  // the only Gemini import in the quiz feature is inside the generation service
  const generation = read("utils/schatQuiz/generation.js");
  assert.match(generation, /require\("\.\.\/AiProviders\/gemini"\)/);
  const genRoutes = read("endpoints/schatQuizGeneration.js");
  for (const route of genRoutes.matchAll(
    /app\.(post|get)\(\s*"([^"]+)",\s*(\w+)/g
  ))
    assert.equal(route[3], "adminOnly", `${route[2]} must be admin only`);
  const quizRoutes = read("endpoints/schatQuiz.js");
  for (const route of quizRoutes.matchAll(
    /app\.\w+\(\s*"(\/schat-admin[^"]+)",\s*(\w+)/g
  ))
    assert.equal(route[2], "adminOnly", `${route[1]} must be admin only`);
  // the loaded bank module graph contains no AI provider
  require("../../../utils/schatQuiz/bank");
  require("../../../endpoints/schatQuiz");
  const loaded = Object.keys(require.cache).filter((f) =>
    /AiProviders[\\/]gemini|schatQuiz[\\/]generation/.test(f)
  );
  assert.deepEqual(loaded, []);
});

test("migration only creates new tables", () => {
  const sql = read(
    "prisma/migrations/20260927030000_schat_guideline_quiz/migration.sql"
  );
  // statements only (FK clauses such as "ON DELETE CASCADE" are fine)
  assert.doesNotMatch(sql, /^\s*(ALTER|DROP|INSERT|UPDATE|DELETE|PRAGMA)\b/im);
  const created = [...sql.matchAll(/CREATE TABLE "([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(created, [
    "schat_quiz_sets",
    "schat_quiz_questions",
    "schat_quiz_attempts",
    "schat_quiz_answers",
    "schat_quiz_wrong_notes",
    "schat_quiz_generation_logs",
  ]);
});

test("evidence comes from the chosen document's body text, bounded", async () => {
  const generation = require("../../../utils/schatQuiz/generation");
  const docs = [
    ["가상 수혈 확인 절차 첫 문장", { document_id: "D1", page: 5 }],
    ["가상 수혈 부작용 관찰", { document_id: "D1", page: 7 }],
    [
      "가상 수혈 그림 설명",
      { document_id: "D1", page: 5, content_type: "image_description" },
    ],
    ["관련 없는 가상 내용", { document_id: "D1", page: 9 }],
  ];
  let where = null;
  const fakeDb = {
    normalize: (s) => s,
    connect: async () => ({
      client: {
        getCollection: async () => ({
          get: async (args) => {
            where = args.where;
            return {
              ids: docs.map((_, i) => `id${i}`),
              documents: docs.map((d) => d[0]),
              metadatas: docs.map((d) => d[1]),
            };
          },
        }),
      },
    }),
  };
  const evidence = await generation.collectEvidence(
    { documentId: "D1", workspaceSlug: "ws", topic: "수혈" },
    { vectorDb: fakeDb }
  );
  assert.deepEqual(where, { document_id: "D1" });
  assert.deepEqual(
    evidence.map((e) => e.page),
    [5, 7]
  );
  assert.equal(
    evidence.some((e) => /그림 설명/.test(e.text)),
    false
  );
  const prompt = generation.systemPrompt({
    type: "multiple_choice",
    difficulty: "beginner",
  });
  for (const rule of [
    /일반 의학지식/,
    /정답은 하나만/,
    /숫자·시간·용량/,
    /sourcePage/,
    /insufficient/,
  ])
    assert.match(prompt, rule);
  assert.equal(generation.GENERATION_SCHEMA.additionalProperties, false);
});

test("questions keep their source document; a replaced document is marked, not remapped", () => {
  const bank = require("../../../utils/schatQuiz/bank");
  const q = {
    id: 1,
    quiz_set_id: null,
    question: "가상 질문",
    choices: JSON.stringify(core.toChoices(["가", "나", "다", "라"])),
    correct_choice_id: "c1",
    correct_ox: null,
    explanation: "가상 해설",
    topic: "가상",
    difficulty: "beginner",
    question_type: "multiple_choice",
    document_id: "old-doc-0001",
    source_document_name: "가상지침 (구버전).pdf",
    document_version: "v1",
    source_page: 3,
    status: "approved",
  };
  const old = bank.presentAdminQuestion(q, new Map());
  assert.equal(old.outdated, true);
  assert.equal(old.documentName, "가상지침 (구버전).pdf");
  assert.equal(old.source.pdfRef, null);
  assert.equal(old.source.outdated, true);
  const live = new Map([
    [
      "old-doc-0001",
      { documentId: "old-doc-0001", workspaceSlug: "ws", pages: new Set([3]) },
    ],
  ]);
  const current = bank.presentAdminQuestion(q, live);
  assert.equal(current.outdated, false);
  assert.equal(current.documentName, "가상지침 (구버전).pdf");
  assert.equal(current.source.workspaceSlug, "ws");
});

test("staff reads are scoped to the signed-in user", () => {
  const bank = read("utils/schatQuiz/bank.js");
  // another person's attempt looks like a missing one
  assert.match(bank, /if \(!attempt \|\| attempt\.user_id !== userId\)/);
  for (const fn of ["history", "wrongNotes", "recentQuestionIds"]) {
    const body = bank.slice(bank.indexOf(`async function ${fn}(`));
    assert.match(body.slice(0, 400), /where: \{ user_id: userId/);
  }
  assert.match(
    bank,
    /deleteMany\(\{\s*where: \{ id: Number\(noteId\), user_id: userId \}/
  );
  // admin statistics expose aggregates only (no user ids or names)
  const stats = bank.slice(bank.indexOf("async function adminStats"));
  assert.doesNotMatch(
    stats.slice(0, stats.indexOf("module.exports")),
    /display_name|username|employee_number/
  );
  const routes = read("endpoints/schatQuiz.js");
  assert.match(routes, /"\/schat-admin\/quiz\/stats",\s*adminOnly/);
});

function fakeVectorDb(docs) {
  return {
    normalize: (x) => x,
    connect: async () => ({
      client: {
        getCollection: async () => ({
          get: async () => ({
            ids: docs.map((_, i) => `id${i}`),
            documents: docs.map((d) => d[0]),
            metadatas: docs.map((d) => d[1]),
          }),
        }),
      },
    }),
  };
}
const LIVE = new Map([
  [
    "D1",
    {
      documentId: "D1",
      docKey: core.docKeyOf("D1"),
      title: "가상지침.pdf",
      version: "v1",
      workspaceSlug: "ws",
      pages: new Set([5]),
    },
  ],
]);
const INPUT = {
  docKey: core.docKeyOf("D1"),
  topic: "수혈",
  count: 3,
  difficulty: "beginner",
  questionType: "multiple_choice",
};

test("a Gemini failure gives a friendly message and changes no questions", async () => {
  const generation = require("../../../utils/schatQuiz/generation");
  const logs = [];
  const before = generation.counters.geminiCalls;
  await assert.rejects(
    generation.generate(1, INPUT, {
      live: LIVE,
      log: async (row) => logs.push(row),
      vectorDb: fakeVectorDb([
        ["가상 수혈 확인 절차", { document_id: "D1", page: 5 }],
      ]),
      llm: {
        getChatCompletion: async () => {
          throw new Error("429 Resource has been exhausted (quota)");
        },
      },
    }),
    (error) =>
      error.userFacing &&
      error.message === "문제를 생성하지 못했습니다. 잠시 후 다시 시도해주세요."
  );
  assert.equal(generation.counters.geminiCalls, before + 1);
  assert.deepEqual(
    logs.map((l) => [l.status, l.error_code]),
    [["failed", "rate_limited"]]
  );
});

test("no evidence for the topic means no Gemini call at all", async () => {
  const generation = require("../../../utils/schatQuiz/generation");
  const logs = [];
  let called = false;
  const before = generation.counters.geminiCalls;
  await assert.rejects(
    generation.generate(1, INPUT, {
      live: LIVE,
      log: async (row) => logs.push(row),
      vectorDb: fakeVectorDb([
        ["관련 없는 가상 내용", { document_id: "D1", page: 5 }],
        [
          "가상 수혈 그림",
          { document_id: "D1", page: 5, content_type: "image_description" },
        ],
      ]),
      llm: {
        getChatCompletion: async () => {
          called = true;
          return null;
        },
      },
    }),
    /근거를 찾지 못했습니다/
  );
  assert.equal(called, false);
  assert.equal(generation.counters.geminiCalls, before);
  assert.equal(logs[0].status, "no_evidence");
});
