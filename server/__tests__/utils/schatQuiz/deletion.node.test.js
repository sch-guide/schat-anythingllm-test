const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const core = require("../../../utils/schatQuiz/core");

// 실제 DB 대신 이 검사 안의 합성 자료만 사용한다.
function load(relative, dependencies) {
  const filename = path.resolve(__dirname, "../../../", relative);
  const module = { exports: {} };
  vm.runInNewContext(
    fs.readFileSync(filename, "utf8"),
    {
      module,
      exports: module.exports,
      console,
      Date,
      Map,
      Set,
      require: (name) =>
        name in dependencies
          ? dependencies[name]
          : require(require.resolve(name, { paths: [path.dirname(filename)] })),
    },
    { filename }
  );
  return module.exports;
}
function matches(row, where = {}) {
  return Object.entries(where).every(([key, value]) => {
    if (value && typeof value === "object") {
      if ("in" in value && !value.in.includes(row[key])) return false;
      if ("not" in value && row[key] === value.not) return false;
      if ("contains" in value && !row[key]?.includes(value.contains))
        return false;
      return true;
    }
    return row[key] === value;
  });
}
function fixture(extra = 0) {
  const base = {
    ...core.validateQuestionInput({
      questionType: "ox",
      difficulty: "beginner",
      topic: "가상",
      question: "합성 질문인가요?",
      correctOx: "O",
      explanation: "합성 근거입니다.",
      sourcePage: 1,
    }).value,
    source_document_name: "합성.pdf",
    quiz_set_id: null,
  };
  const questions = [
    { ...base, id: 1, document_id: "current", status: "approved" },
    { ...base, id: 2, document_id: "archived", status: "approved" },
    { ...base, id: 3, document_id: "missing", status: "draft" },
    { ...base, id: 4, document_id: "current", status: "deleted" },
    ...Array.from({ length: extra }, (_, i) => ({
      ...base,
      id: i + 5,
      document_id: "missing",
      status: "inactive",
    })),
  ];
  const attempts = [
    {
      id: 11,
      user_id: 7,
      status: "completed",
      total: 1,
      answered_count: 1,
      correct_count: 0,
      score: 0,
      question_ids: "[2]",
      choice_orders: "{}",
      filters: "{}",
    },
  ];
  const answers = [
    {
      id: 1,
      user_id: 7,
      attempt_id: 11,
      question_id: 2,
      selected_ox: "X",
      is_correct: false,
    },
  ];
  const notes = [
    { id: 1, user_id: 7, question_id: 2, selected_ox: "X", wrong_count: 1 },
  ];
  let beforeUpdate = null;
  const table = (rows) => ({
    findMany: async ({ where, take } = {}) => {
      const result = rows.filter((r) => matches(r, where));
      return take ? result.slice(0, take) : result;
    },
    findUnique: async ({ where }) =>
      rows.find((r) => matches(r, where)) || null,
    updateMany: async ({ where, data }) => {
      if (beforeUpdate) {
        const hook = beforeUpdate;
        beforeUpdate = null;
        hook();
      }
      const found = rows.filter((r) => matches(r, where));
      found.forEach((r) => Object.assign(r, data));
      return { count: found.length };
    },
    update: async ({ where, data }) => {
      const found = rows.find((r) => matches(r, where));
      Object.assign(found, data);
      return found;
    },
    deleteMany: async ({ where }) => {
      const found = rows.filter((r) => matches(r, where));
      for (const r of found) rows.splice(rows.indexOf(r), 1);
      return { count: found.length };
    },
  });
  const db = {
    system_settings: { upsert: async () => ({}) },
    workspaces: table([{ id: 1, slug: "synthetic" }]),
    workspace_documents: table([
      {
        workspaceId: 1,
        metadata: JSON.stringify({
          document_id: "current",
          title: "합성.pdf",
          page: 1,
        }),
      },
      {
        workspaceId: 1,
        metadata: JSON.stringify({
          document_id: "archived",
          title: "이전.pdf",
          page: 1,
          schat_document_update_archived: true,
        }),
      },
    ]),
    schat_quiz_questions: table(questions),
    schat_quiz_attempts: table(attempts),
    schat_quiz_answers: table(answers),
    schat_quiz_wrong_notes: {
      ...table(notes),
      findMany: async ({ where }) =>
        notes
          .filter((n) => matches(n, where))
          .map((n) => ({
            ...n,
            question: questions.find((q) => q.id === n.question_id),
          })),
    },
    schat_quiz_sets: table([]),
    schat_quiz_generation_logs: { create: async () => ({ id: 1 }) },
  };
  db.$transaction = async (fn) => fn(db);
  const bank = load("utils/schatQuiz/bank.js", {
    "../prisma": db,
    "./core": core,
    "../originalDocuments": { originalPdfStatus: () => ({ available: false }) },
  });
  return {
    bank,
    db,
    questions,
    attempts,
    answers,
    notes,
    race: (fn) => {
      beforeUpdate = fn;
    },
  };
}

test("일반 삭제 후 과거 기록·점수·오답노트·통계를 보존하고 신규 출제에서 제외한다", async () => {
  const f = fixture();
  const stats = JSON.stringify(await f.bank.adminStats());
  const history = JSON.stringify(await f.bank.history(7));
  await f.bank.deleteQuestions([2]);
  assert.equal(f.questions.find((q) => q.id === 2)?.status, "deleted");
  assert.equal(f.answers.length, 1);
  assert.equal(f.notes.length, 1);
  assert.equal(JSON.stringify(await f.bank.history(7)), history);
  // 통계는 삭제한 문제의 풀이를 빼고 계산하며 뺀 개수를 알려 준다.
  const before = JSON.parse(stats);
  assert.equal(before.totals.answers, 1);
  const after = await f.bank.adminStats();
  assert.equal(after.totals.answers, 0);
  assert.equal(after.excludedDeletedAnswers, 1);
  assert.equal(after.perQuestion.length, 0);
  assert.equal(after.totals.completedAttempts, 0);
  assert.equal(
    (await f.bank.attemptView(7, 11)).questions[0].answer.correctOx,
    "O"
  );
  assert.equal((await f.bank.wrongNotes(7))[0].available, false);
  assert.deepEqual(
    Array.from((await f.bank.adminList()).map((q) => q.id)).sort(),
    [1, 3]
  );
  assert.equal((await f.bank.staffOptions()).total, 1);
});

test("보관된 문서는 이전 문서이며 500개를 넘어도 이전 문서 목록과 삭제 대상이 모두 보인다", async () => {
  const f = fixture(505);
  assert.deepEqual(
    Array.from(
      (await f.bank.adminList({ documentState: "current" })).map((q) => q.id)
    ),
    [1]
  );
  const previous = await f.bank.adminList({ documentState: "outdated" });
  assert.equal(previous.length, 507);
  assert.equal(
    previous.every((q) => q.outdated),
    true
  );
  await f.bank.deleteQuestions(Array.from(previous.map((q) => q.id)), {
    filters: { documentState: "outdated" },
    adminId: 9,
  });
  assert.equal(
    (await f.bank.adminList({ documentState: "outdated" })).length,
    0
  );
  assert.equal(f.questions[0].status, "approved");
});

test("이전 문서 전체 삭제는 누락되거나 현재 문서를 섞은 대상을 거부한다", async () => {
  const f = fixture();
  for (const ids of [[2], [1, 2, 3]])
    await assert.rejects(
      f.bank.deleteQuestions(ids, { filters: { documentState: "outdated" } }),
      /대상.*바뀌|다시 확인/
    );
  assert.equal(f.questions.filter((q) => q.status === "deleted").length, 1);
  for (const ids of [null, "2", [], [0], [1.5], ["bad"]])
    await assert.rejects(
      f.bank.deleteQuestions(ids),
      (e) => e.userFacing === true
    );
});

test("삭제된 문제는 수정·공개·다시 생성할 수 없다", async () => {
  const f = fixture();
  await assert.rejects(f.bank.adminUpdate(9, 4, {}), /삭제|찾을 수/);
  await assert.rejects(f.bank.setStatus(9, [4], "approved"), /삭제|찾을 수/);
  const generation = load("utils/schatQuiz/generation.js", {
    "../prisma": f.db,
    "./core": core,
    "./bank": f.bank,
  });
  await assert.rejects(generation.regenerate(9, 4), /삭제|찾을 수/);
  assert.equal(generation.counters.geminiCalls, 0);
  assert.equal(f.questions[3].status, "deleted");
});

test("공개 또는 수정 직전에 삭제되면 삭제 상태와 문제 본문을 유지한다", async () => {
  for (const operation of ["publish", "edit"]) {
    const f = fixture();
    const q = f.questions[0];
    f.race(() => {
      q.status = "deleted";
    });
    const input = {
      question: "바뀐 합성 질문?",
      correctOx: "O",
      explanation: "합성 해설",
      topic: "가상",
      difficulty: "beginner",
      sourcePage: 1,
    };
    await assert.rejects(
      operation === "publish"
        ? f.bank.setStatus(9, [1], "approved")
        : f.bank.adminUpdate(9, 1, input),
      /삭제|바뀌|찾을 수/
    );
    assert.equal(q.status, "deleted");
    assert.equal(q.question, "합성 질문인가요?");
  }
});

test("다시 생성 응답을 기다리는 중 삭제되면 문제를 되살리지 않는다", async () => {
  const f = fixture();
  const q = f.questions[0];
  q.status = "draft";
  const generation = load("utils/schatQuiz/generation.js", {
    "../prisma": f.db,
    "./core": core,
    "./bank": f.bank,
    "../helpers": {},
    "../vectorDbProviders/chroma/schatBm25": {
      rankByBm25: (_topic, corpus) => corpus,
    },
  });
  const vectorDb = {
    connect: async () => ({
      client: {
        getCollection: async () => ({
          get: async () => ({
            ids: ["one"],
            documents: ["합성 근거입니다."],
            metadatas: [{ page: 1 }],
          }),
        }),
      },
    }),
  };
  const llm = {
    getChatCompletion: async () => {
      q.status = "deleted";
      return {
        textResponse: JSON.stringify({
          questions: [
            {
              question: "새 합성 질문?",
              choices: [],
              correctIndex: -1,
              oxAnswer: "O",
              explanation: "합성 근거입니다.",
              sourcePage: 1,
              evidenceQuote: "합성 근거입니다.",
            },
          ],
        }),
      };
    },
  };
  await assert.rejects(
    generation.regenerate(9, 1, { vectorDb, llm }),
    /삭제|바뀌|찾을 수/
  );
  assert.equal(q.status, "deleted");
  assert.equal(q.question, "합성 질문인가요?");
});

test("삭제 경로는 직원 권한과 잘못된 확인을 거부하고 관리자의 정확한 대상을 전달한다", async () => {
  const f = fixture();
  const role = load("utils/middleware/multiUserProtected.js", {
    "../../models/systemSettings": {
      SystemSettings: { isMultiUserMode: async () => true },
    },
    "../http": { userFromSession: async () => null },
  });
  const routes = new Map();
  const app = Object.fromEntries(
    ["get", "post", "patch", "delete"].map((method) => [
      method,
      (url, ...handlers) => routes.set(`${method} ${url}`, handlers.flat()),
    ])
  );
  load("endpoints/schatQuiz.js", {
    "../utils/http": { reqBody: (r) => r.body },
    "../utils/middleware/validatedRequest": {
      validatedRequest: (_r, _s, next) => next(),
    },
    "../utils/middleware/multiUserProtected": role,
    "../utils/schatQuiz/bank": f.bank,
  }).schatQuizEndpoints(app);
  async function request(userRole, body) {
    const response = {
      locals: { user: { id: 9, role: userRole }, multiUserMode: true },
      statusCode: 200,
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(body) {
        this.body = body;
        return this;
      },
      sendStatus(code) {
        this.statusCode = code;
        return this;
      },
      end() {
        return this;
      },
    };
    const handlers = routes.get("post /schat-admin/quiz/questions/delete");
    const req = { body, method: "POST" };
    for (const handler of handlers) {
      let proceed = false;
      await handler(req, response, () => {
        proceed = true;
      });
      if (!proceed) break;
    }
    return response;
  }
  assert.equal(
    (await request("default", { ids: [2], confirm: "삭제" })).statusCode,
    401
  );
  assert.equal(f.questions[1].status, "approved");
  assert.equal(
    (await request("admin", { ids: [2], confirm: " 삭제" })).statusCode,
    400
  );
  const stale = await request("admin", {
    ids: [2],
    confirm: "삭제",
    filters: { documentState: "outdated" },
  });
  assert.equal(stale.statusCode, 400);
  assert.equal(f.questions[1].status, "approved");
  const valid = await request("admin", {
    ids: [2, 3],
    confirm: "삭제",
    filters: { documentState: "outdated" },
  });
  assert.equal(valid.statusCode, 200);
  assert.equal(valid.body.count, 2);
  assert.equal(f.questions[1].updated_by, 9);
});

test("퀴즈 세트의 문제 수에도 삭제한 문제가 포함되지 않는다", async () => {
  const f = fixture();
  f.db.schat_quiz_sets.findMany = async () => [
    {
      id: 1,
      document_id: "current",
      questions: [f.questions[0], f.questions[3]],
    },
  ];
  assert.equal((await f.bank.adminSets())[0].questions, 1);
});

test("삭제한 퀴즈 목록과 되살리기: 기록은 그대로, 되살린 문제는 사용중지이고 이전 문서는 계속 풀이 불가", async () => {
  const f = fixture();
  await f.bank.deleteQuestions([1, 2]);
  const deleted = await f.bank.adminList({ documentState: "deleted" });
  assert.deepEqual(Array.from(deleted.map((q) => q.id)).sort(), [1, 2, 4]);
  assert.equal(deleted.every((q) => q.status === "deleted"), true);
  const notes = await f.bank.wrongNotes(7);
  assert.equal(notes[0].previousGuideline, true);
  assert.equal(notes[0].available, false);
  await assert.rejects(() => f.bank.startWrongReview(7), /다시 풀 틀린 문제가 없습니다/);

  const restored = await f.bank.restoreQuestions([1, 2]);
  assert.equal(restored.count, 2);
  assert.equal(f.questions.find((q) => q.id === 1).status, "inactive");
  assert.equal(f.questions.find((q) => q.id === 2).status, "inactive");
  assert.equal(f.answers.length, 1);
  assert.equal(f.notes.length, 1);
  await assert.rejects(
    () => f.bank.setStatus(1, [2], "approved"),
    /이전 문서 기반 문제는 공개할 수 없습니다/
  );
  await f.bank.setStatus(1, [1], "approved");
  assert.equal((await f.bank.staffOptions()).total, 1);
  await assert.rejects(() => f.bank.restoreQuestions([1]), /상태가 바뀌었습니다/);
});

test("현재 문서의 공개 문제 오답노트는 이전 지침 표시가 없다", async () => {
  const f = fixture();
  f.notes[0].question_id = 1;
  const [note] = await f.bank.wrongNotes(7);
  assert.equal(note.previousGuideline, false);
  assert.equal(note.available, true);
});
