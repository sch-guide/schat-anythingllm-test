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
    if (value && typeof value === "object" && !(key in row) &&
        !["in", "not", "contains"].some((k) => k in value))
      return matches(row, value); // 두 칸 묶음 키(attempt_id_question_id 등)
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
    create: async ({ data }) => {
      const row = { id: Math.max(0, ...rows.map((r) => r.id)) + 1, ...data };
      rows.push(row);
      return row;
    },
    upsert: async ({ where, create, update }) => {
      const found = rows.find((r) => matches(r, where));
      if (found) return Object.assign(found, update);
      const row = { id: Math.max(0, ...rows.map((r) => r.id)) + 1, ...create };
      rows.push(row);
      return row;
    },
    count: async ({ where } = {}) => rows.filter((r) => matches(r, where)).length,
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


// 퀴즈가 아닌 자료: 삭제·연결 뒤에도 한 글자도 바뀌면 안 된다.
function addOtherData(f) {
  const other = {
    users: [{ id: 7, username: "가짜직원" }, { id: 9, username: "가짜관리자" }],
    workspace_chats: [{ id: 1, prompt: "가짜 질문", response: "{}" }],
    schat_synonym_groups: [{ id: 1, terms: "가짜,동의어" }],
    schat_answer_feedback: [{ id: 1, chat_id: 1, rating: "down" }],
  };
  for (const [name, rows] of Object.entries(other)) {
    const t = {
      findMany: async () => rows,
      deleteMany: async () => {
        throw new Error(`퀴즈 외 자료 삭제 시도: ${name}`);
      },
      updateMany: async () => {
        throw new Error(`퀴즈 외 자료 변경 시도: ${name}`);
      },
    };
    f.db[name] = t;
  }
  const docs = JSON.stringify(f.db.workspace_documents);
  return () =>
    JSON.stringify({ other, docs: docs.length });
}

// 두 번째 풀이: 문제 1(현재 문서, 정답)과 문제 2(이전 문서, 오답).
function addMixedAttempt(f) {
  f.attempts.push({
    id: 12,
    user_id: 7,
    status: "completed",
    total: 2,
    answered_count: 2,
    correct_count: 1,
    score: 50,
    question_ids: "[1,2]",
    choice_orders: "{}",
    filters: "{}",
    completedAt: new Date("2026-10-12T01:00:00Z"),
  });
  f.answers.push(
    { id: 2, user_id: 7, attempt_id: 12, question_id: 1, selected_ox: "O", is_correct: true },
    { id: 3, user_id: 7, attempt_id: 12, question_id: 2, selected_ox: "X", is_correct: false }
  );
}

test("삭제 전 확인 수와 진짜 삭제: 문제·풀이·오답노트만 지우고 다른 자료는 그대로", async () => {
  const f = fixture();
  addMixedAttempt(f);
  const snapshot = addOtherData(f);
  const before = snapshot();
  const preview = await f.bank.deletePreview([2]);
  assert.deepEqual(
    { ...preview },
    { questions: 1, answers: 2, wrongNotes: 1 }
  );
  // 확인 창에서 본 수와 다르면 지우지 않는다.
  await assert.rejects(
    f.bank.deleteQuestions([2], { expected: { answers: 1, wrongNotes: 1 } }),
    /기록 수가 바뀌었습니다/
  );
  await assert.rejects(f.bank.deleteQuestions([2]), /기록 수가 바뀌었습니다/);
  assert.equal(f.answers.length, 3);

  const result = await f.bank.deleteQuestions([2], {
    expected: { answers: 2, wrongNotes: 1 },
  });
  assert.equal(result.questions, 1);
  assert.equal(f.questions.some((q) => q.id === 2), false);
  assert.equal(f.answers.some((a) => a.question_id === 2), false);
  assert.equal(f.notes.length, 0);
  // 문제 2만 있던 풀이 회차는 지우고, 섞인 회차는 남은 문제로 다시 계산한다.
  assert.equal(f.attempts.some((a) => a.id === 11), false);
  const mixed = f.attempts.find((a) => a.id === 12);
  assert.equal(mixed.question_ids, "[1]");
  assert.equal(mixed.total, 1);
  assert.equal(mixed.correct_count, 1);
  assert.equal(mixed.score, 100);
  // 문제 1(현재 문서)의 풀이는 그대로.
  assert.equal(f.answers.filter((a) => a.question_id === 1).length, 1);
  assert.equal(snapshot(), before);
});

test("이전 문서 전체 삭제도 개수 확인 뒤 한 번에 지운다(500개 넘어도)", async () => {
  const f = fixture(505);
  assert.deepEqual(
    Array.from(
      (await f.bank.adminList({ documentState: "current" })).map((q) => q.id)
    ),
    [1]
  );
  const previous = await f.bank.adminList({ documentState: "outdated" });
  assert.equal(previous.length, 507);
  const ids = Array.from(previous.map((q) => q.id));
  const filters = { documentState: "outdated" };
  const counts = await f.bank.deletePreview(ids, { filters });
  assert.equal(counts.questions, 507);
  assert.equal(counts.answers, 1);
  await f.bank.deleteQuestions(ids, { filters, expected: counts });
  assert.equal((await f.bank.adminList({ documentState: "outdated" })).length, 0);
  assert.equal(f.questions.find((q) => q.id === 1).status, "approved");
  assert.equal(f.answers.length, 0);
});

test("이전 문서가 된 문제는 삭제 전이라도 직원 오답노트·풀이 기록·점수에서 빠진다", async () => {
  const f = fixture();
  addMixedAttempt(f);
  // 문제 2(이전 문서)의 오답노트는 보이지 않는다.
  assert.equal((await f.bank.wrongNotes(7)).length, 0);
  // 문제 2만 있던 회차는 숨기고, 섞인 회차는 문제 1만으로 100점.
  const history = await f.bank.history(7);
  assert.equal(history.length, 1);
  assert.equal(history[0].id, 12);
  assert.equal(history[0].total, 1);
  assert.equal(history[0].score, 100);
  const view = await f.bank.attemptView(7, 12);
  assert.equal(view.total, 1);
  assert.equal(view.questions.length, 1);
  assert.equal(view.score, 100);
  await assert.rejects(f.bank.startWrongReview(7), /다시 풀 틀린 문제가 없습니다/);
  // 관리자 통계도 이전 문서 문제를 뺀다.
  const stats = await f.bank.adminStats();
  assert.equal(stats.totals.answers, 1);
  assert.equal(stats.totals.rate, 100);
  assert.equal(stats.excludedOutdatedAnswers, 2);
  assert.equal(stats.totals.completedAttempts, 1);
  assert.deepEqual(Array.from(stats.perQuestion.map((q) => q.questionId)), [1]);
  // 기록 자체는 지우지 않는다(관리자가 [삭제]할 때만 지움).
  assert.equal(f.answers.length, 3);
  assert.equal(f.notes.length, 1);
});

test("풀이 도중 이전 문서가 된 문제는 풀 수 없고, 남은 문제만 풀면 끝난다", async () => {
  const f = fixture();
  f.attempts.push({
    id: 13, user_id: 7, status: "in_progress", total: 2, answered_count: 0,
    correct_count: 0, score: null, question_ids: "[1,2]", choice_orders: "{}", filters: "{}",
  });
  await assert.rejects(
    f.bank.answerQuestion(7, 13, 2, { ox: "O" }),
    /지금 출제되지 않습니다/
  );
  const result = await f.bank.answerQuestion(7, 13, 1, { ox: "O" });
  assert.equal(result.progress.total, 1);
  assert.equal(result.progress.completed, true);
  assert.equal(result.progress.finalScore, 100);
  assert.equal(f.attempts.find((a) => a.id === 13).status, "completed");
});

// ---- 문서 새 버전 연결 ---------------------------------------------------------

function relinkFixture() {
  const f = fixture();
  // 문제 1·5·6·7: 모두 "current" 문서에서 만든 문제. 근거 문장만 다르다.
  const base = f.questions[0];
  f.questions.push(
    { ...base, id: 5, status: "approved", quiz_set_id: 3, source_excerpt: "헤파린은 1시간마다 aPTT를 확인한다." },
    { ...base, id: 6, status: "approved", quiz_set_id: 3, source_excerpt: "수액은 1시간에 100 mL 이하로 주입한다." },
    { ...base, id: 7, status: "draft", quiz_set_id: 3, source_excerpt: "체온 38℃ 이상이면 담당의에게 보고한다." },
    { ...base, id: 8, status: "approved", quiz_set_id: 3, source_excerpt: "소변량은 시간당 0.5 mL/kg 미만이면 보고한다." }
  );
  f.questions[0].source_excerpt = "합성 근거입니다.";
  f.questions[0].quiz_set_id = 3;
  f.db.schat_quiz_sets = {
    rows: [{ id: 3, document_id: "current", document_version: "v1" }],
    updateMany: async ({ where, data }) => {
      const found = f.db.schat_quiz_sets.rows.filter(
        (r) => where.id.in.includes(r.id) && where.document_id.in.includes(r.document_id)
      );
      found.forEach((r) => Object.assign(r, data));
      return { count: found.length };
    },
  };
  f.answers.push({ id: 9, user_id: 7, attempt_id: 11, question_id: 5, selected_ox: "O", is_correct: true });
  return f;
}

test("새 버전에 근거 문장이 그대로면 계속 쓰고, 숫자·단위가 바뀌면 이전 문서로 돌린다", async () => {
  const f = relinkFixture();
  const snapshot = addOtherData(f);
  const before = snapshot();
  const newPages = [
    // 띄어쓰기·줄바꿈·글머리 기호·쪽 번호가 달라도 같은 문장으로 본다.
    { page: 4, text: "• 합성   근거\n입니다.\n- 헤파린은 1시간마다\n  aPTT를 확인한다." },
    // 숫자만 바뀜(100 → 120): 바뀜.
    { page: 5, text: "수액은 1시간에 120 mL 이하로 주입한다." },
    // 온도 숫자 바뀜(38 → 37.5): 바뀜.
    { page: 6, text: "체온 37.5℃ 이상이면 담당의에게 보고한다." },
    // 단위 바뀜(mL/kg → mL): 못 찾음.
    { page: 7, text: "소변량은 시간당 0.5 mL 미만이면 보고한다." },
  ];
  const summary = await f.bank.relinkAfterDocumentUpdate(
    [{
      oldDocumentIds: ["current"], documentId: "current-v2", title: "합성.pdf",
      version: "v2", workspaceSlug: "synthetic", pages: newPages,
    }],
    { db: f.db }
  );
  assert.deepEqual({ ...summary }, { total: 5, kept: 2, outdated: 3, changed: 2, missing: 1 });
  const byId = (id) => f.questions.find((q) => q.id === id);
  assert.equal(byId(1).document_id, "current-v2");
  assert.equal(byId(1).source_page, 4);
  assert.equal(byId(5).document_id, "current-v2");
  assert.equal(byId(5).source_page, 4);
  assert.equal(byId(5).document_version, "v2");
  for (const id of [6, 7, 8]) assert.equal(byId(id).document_id, "current");
  // 이어 쓴 문제의 직원 풀이 기록은 그대로다.
  assert.equal(f.answers.filter((a) => a.question_id === 5).length, 1);
  assert.equal(f.db.schat_quiz_sets.rows[0].document_id, "current-v2");
  assert.equal(snapshot(), before);
});

test("근거 문장이 없거나 다른 문서의 문제는 건드리지 않는다", async () => {
  const f = fixture();
  f.questions[0].source_excerpt = null;
  const summary = await f.bank.relinkAfterDocumentUpdate(
    [{ oldDocumentIds: ["current"], documentId: "new", pages: [{ page: 1, text: "합성 근거입니다." }] }],
    { db: f.db }
  );
  assert.equal(summary.total, 1);
  assert.equal(summary.outdated, 1);
  assert.equal(f.questions[0].document_id, "current");
  assert.equal(f.questions[1].document_id, "archived");
});

test("근거 비교 규칙: 숫자 경계·쪽 경계·목록 번호", () => {
  const pages = [
    { page: 1, text: "헤파린 25 mg 투여 후 30분 관찰" },
    { page: 2, text: "경계 문장의 앞부분이고" },
    { page: 3, text: "뒷부분이다" },
    { page: 4, text: "3. 혈압을 측정한다" },
  ];
  const status = (e) => core.compareEvidence(e, pages).status;
  assert.equal(status("25 mg 투여 후 30분 관찰"), "same");
  assert.equal(status("5 mg 투여 후 30분 관찰"), "changed");
  assert.equal(status("헤파린 25 mg 투여 후 3분"), "changed");
  assert.equal(status("헤파린 25 mcg 투여 후 30분 관찰"), "missing");
  assert.equal(core.compareEvidence("앞부분이고 뒷부분이다", pages).page, 2);
  assert.equal(status("혈압을 측정한다"), "same");
  // 목록 번호가 바뀐 경우는 안전하게 '바뀜'으로 본다.
  assert.equal(status("4. 혈압을 측정한다"), "changed");
  assert.equal(status(""), "missing");
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

test("삭제 경로는 직원 권한과 잘못된 확인·바뀐 대상을 거부하고 관리자 요청만 지운다", async () => {
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
    (await request("admin", { ids: [2], confirm: " 삭제", expected: { answers: 1, wrongNotes: 1 } })).statusCode,
    400
  );
  const stale = await request("admin", {
    ids: [2],
    confirm: "삭제",
    filters: { documentState: "outdated" },
    expected: { answers: 1, wrongNotes: 1 },
  });
  assert.equal(stale.statusCode, 400);
  assert.equal(f.questions[1].status, "approved");
  const valid = await request("admin", {
    ids: [2, 3],
    confirm: "삭제",
    filters: { documentState: "outdated" },
    expected: { answers: 1, wrongNotes: 1 },
  });
  assert.equal(valid.statusCode, 200);
  assert.equal(valid.body.questions, 2);
  assert.deepEqual(Array.from(f.questions.map((q) => q.id)), [1, 4]);
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


// ---- 퀴즈 세트 삭제 -------------------------------------------------------------

function setFixture() {
  const f = fixture();
  const sets = [
    { id: 1, title: "공개 세트", status: "approved", document_id: "current" },
    { id: 2, title: "중지 세트", status: "inactive", document_id: "archived" },
    { id: 3, title: "빈 세트", status: "draft", document_id: "current" },
  ];
  f.sets = sets;
  f.db.schat_quiz_sets = {
    findUnique: async ({ where }) => sets.find((s) => s.id === where.id) || null,
    deleteMany: async ({ where }) => {
      const before = sets.length;
      for (const s of [...sets]) if (s.id === where.id) sets.splice(sets.indexOf(s), 1);
      return { count: before - sets.length };
    },
  };
  f.questions.find((q) => q.id === 1).quiz_set_id = 1;
  f.questions.find((q) => q.id === 2).quiz_set_id = 2;
  // 다른 직원(8)도 문제 2를 풀었다.
  f.attempts.push({ id: 21, user_id: 8, status: "completed", total: 1, answered_count: 1, correct_count: 1, score: 100, question_ids: "[2]", choice_orders: "{}", filters: "{}" });
  f.answers.push({ id: 31, user_id: 8, attempt_id: 21, question_id: 2, selected_ox: "O", is_correct: true });
  return f;
}

test("공개 중인 세트는 확인도 삭제도 거절한다", async () => {
  const f = setFixture();
  await assert.rejects(f.bank.setDeletePreview(1), /먼저 사용중지/);
  await assert.rejects(
    f.bank.deleteSet(1, { expected: { questions: 1, answers: 0, wrongNotes: 0, staff: 0 } }),
    /먼저 사용중지/
  );
  assert.equal(f.sets.length, 3);
  assert.ok(f.questions.some((q) => q.id === 1));
});

test("빈 세트는 문제·기록 0으로 확인되고 세트만 지운다", async () => {
  const f = setFixture();
  const snapshot = addOtherData(f);
  const before = snapshot();
  const answersBefore = f.answers.length;
  const preview = await f.bank.setDeletePreview(3);
  assert.deepEqual({ ...preview }, { title: "빈 세트", questions: 0, answers: 0, wrongNotes: 0, staff: 0 });
  await f.bank.deleteSet(3, { expected: preview });
  assert.deepEqual(Array.from(f.sets.map((s) => s.id)), [1, 2]);
  assert.equal(f.answers.length, answersBefore);
  assert.equal(f.questions.length, 4);
  assert.equal(snapshot(), before);
});

test("기록이 있는 세트는 직원 수와 기록 수를 보여 주고, 그 수가 맞을 때만 문제·기록과 함께 지운다", async () => {
  const f = setFixture();
  const preview = await f.bank.setDeletePreview(2);
  assert.deepEqual({ ...preview }, { title: "중지 세트", questions: 1, answers: 2, wrongNotes: 1, staff: 2 });
  await assert.rejects(
    f.bank.deleteSet(2, { expected: { ...preview, staff: 1 } }),
    /수가 바뀌었습니다/
  );
  await assert.rejects(f.bank.deleteSet(2), /수가 바뀌었습니다/);
  assert.equal(f.sets.length, 3);
  await f.bank.deleteSet(2, { expected: preview });
  assert.deepEqual(Array.from(f.sets.map((s) => s.id)), [1, 3]);
  assert.equal(f.questions.some((q) => q.id === 2), false);
  assert.equal(f.answers.some((a) => a.question_id === 2), false);
  assert.equal(f.notes.length, 0);
  assert.equal(f.attempts.some((a) => a.id === 11 || a.id === 21), false);
  // 다른 세트의 문제는 그대로.
  assert.ok(f.questions.some((q) => q.id === 1));
  await assert.rejects(f.bank.setDeletePreview(2), /찾을 수 없습니다/);
});
