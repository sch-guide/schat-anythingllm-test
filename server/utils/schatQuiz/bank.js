// SCHAT 지침서 퀴즈 - question bank, attempts and statistics.
// DATABASE ONLY: this module must never import an AI provider or the
// generation service. Staff quiz endpoints use nothing but this file, so no
// staff action can reach Gemini (see __tests__/utils/schatQuiz).
const rootPrisma = require("../prisma");
const { AsyncLocalStorage } = require("node:async_hooks");
const writeContext = new AsyncLocalStorage();
let writeQueue = Promise.resolve();
const LOCK_LABEL = "schat_quiz_write_boundary";
// 기존 함수의 모든 읽기와 쓰기를 현재 저장 트랜잭션 안으로 연결한다.
const prisma = new Proxy(rootPrisma, {
  get(target, key) {
    const tx = writeContext.getStore();
    if (tx && key === "$transaction")
      return (work) => typeof work === "function" ? work(tx) : Promise.all(work);
    const db = tx || target;
    return typeof db[key] === "function" ? db[key].bind(db) : db[key];
  },
});

function withQuizWrite(fn) {
  const current = writeContext.getStore();
  if (current) return Promise.resolve().then(() => fn(current));
  const job = writeQueue.then(() => rootPrisma.$transaction(async (tx) => {
    // SQLite의 쓰기 잠금을 어떤 퀴즈 자료를 읽기 전에 확보한다.
    // 여러 서버 프로세스에서도 삭제·문서 교체와 새 풀이가 교차하지 않는다.
    await tx.system_settings.upsert({
      where: { label: LOCK_LABEL },
      create: { label: LOCK_LABEL, value: "1" },
      update: { value: "1" },
    });
    return writeContext.run(tx, () => fn(tx));
  }));
  writeQueue = job.catch(() => {});
  return job;
}
const core = require("./core");

function userError(message) {
  const error = new Error(message);
  error.userFacing = true;
  return error;
}

// ---- live documents ----------------------------------------------------------

let liveCache = null;
const LIVE_TTL_MS = 30 * 1000;

/**
 * Documents currently in a workspace, by document_id: title, version, slug and
 * the page numbers that exist. A question whose document is not here was made
 * from an earlier upload ("이전 문서 기반") and is not given to staff.
 */
async function liveDocuments({ fresh = false, db = prisma } = {}) {
  if (
    db === prisma &&
    !fresh &&
    !writeContext.getStore() &&
    liveCache &&
    Date.now() - liveCache.at < LIVE_TTL_MS
  )
    return liveCache.map;
  const workspaces = await db.workspaces.findMany({
    select: { id: true, slug: true },
  });
  const slugById = new Map(workspaces.map((w) => [w.id, w.slug]));
  const rows = await db.workspace_documents.findMany({
    select: { workspaceId: true, metadata: true },
  });
  const map = new Map();
  for (const row of rows) {
    let m = {};
    try {
      m = JSON.parse(row.metadata || "{}");
    } catch {}
    if (m.schat_document_update_archived === true) continue;
    const id = String(m.document_id || "").trim();
    if (!id) continue;
    const doc = map.get(id) || {
      documentId: id,
      docKey: core.docKeyOf(id),
      title:
        String(m.title || "")
          .split(/[\\/]/)
          .pop() || "이름 없는 문서",
      version: m.document_version || null,
      workspaceSlug: slugById.get(row.workspaceId) || null,
      pages: new Set(),
    };
    const page = Number(m.page);
    if (Number.isInteger(page) && page > 0) doc.pages.add(page);
    map.set(id, doc);
  }
  if (db === prisma && !writeContext.getStore()) liveCache = { at: Date.now(), map };
  return map;
}

function documentByKey(live, docKey) {
  return [...live.values()].find((d) => d.docKey === docKey) || null;
}

// ---- presentation --------------------------------------------------------------

function labels(q) {
  return {
    topic: q.topic,
    difficulty: q.difficulty,
    difficultyLabel: core.DIFFICULTY[q.difficulty] || q.difficulty,
    questionType: q.question_type,
    questionTypeLabel: core.QUESTION_TYPE[q.question_type] || q.question_type,
  };
}

// What staff see before answering: no correct answer, no explanation.
function presentStaffQuestion(q, order = null) {
  const choices = core.parseChoices(q.choices);
  const ordered =
    q.question_type === "multiple_choice"
      ? (order || choices.map((c) => c.id))
          .map((id) => choices.find((c) => c.id === id))
          .filter(Boolean)
      : [];
  return {
    id: q.id,
    question: q.question,
    ...labels(q),
    documentName: q.source_document_name,
    choices: ordered.map((c, i) => ({
      id: c.id,
      text: c.text,
      letter: core.LETTERS[i],
    })),
  };
}

function sourceOf(q, live) {
  const doc = live.get(q.document_id);
  let pdfRef = null;
  if (doc) {
    try {
      const { originalPdfStatus } = require("../originalDocuments");
      const status = originalPdfStatus(q.document_id);
      pdfRef = status.available ? status.pdfRef : null;
    } catch {
      pdfRef = null;
    }
  }
  return {
    documentName: q.source_document_name,
    page: q.source_page,
    section: q.source_section || null,
    excerpt: q.source_excerpt || "",
    pdfRef,
    workspaceSlug: doc?.workspaceSlug || null,
    outdated: !doc,
  };
}

// Shown after the staff member has answered (or in the wrong-answer note).
function presentReveal(q, live) {
  return {
    correctChoiceId: q.correct_choice_id,
    correctOx: q.correct_ox,
    correctText:
      q.question_type === "ox"
        ? q.correct_ox
        : core.parseChoices(q.choices).find((c) => c.id === q.correct_choice_id)
            ?.text || "",
    explanation: q.explanation,
    source: sourceOf(q, live),
  };
}

function presentAdminQuestion(q, live) {
  const doc = live.get(q.document_id);
  return {
    id: q.id,
    quizSetId: q.quiz_set_id,
    quizSetTitle: q.quiz_set?.title || null,
    question: q.question,
    choices: core.parseChoices(q.choices),
    correctChoiceId: q.correct_choice_id,
    correctOx: q.correct_ox,
    explanation: q.explanation,
    ...labels(q),
    documentName: q.source_document_name,
    documentVersion: q.document_version,
    docKey: core.docKeyOf(q.document_id),
    sourcePage: q.source_page,
    sourceSection: q.source_section,
    sourceExcerpt: q.source_excerpt,
    reviewNote: q.review_note,
    status: q.status,
    statusLabel: core.STATUS[q.status] || q.status,
    outdated: !doc,
    source: sourceOf(q, live),
    createdAt: q.createdAt,
    updatedAt: q.updatedAt,
  };
}

// ---- staff: options, start, answer ----------------------------------------------

async function servablePool(live) {
  const rows = await prisma.schat_quiz_questions.findMany({
    where: { status: "approved" },
    include: { quiz_set: { select: { status: true } } },
  });
  return rows.filter(
    (q) => q.quiz_set?.status !== "inactive" && live.has(q.document_id)
  );
}

function matchesFilters(q, f = {}) {
  return (
    (!f.docKey || core.docKeyOf(q.document_id) === f.docKey) &&
    (!f.topic || q.topic === f.topic) &&
    (!f.difficulty || q.difficulty === f.difficulty) &&
    (!f.questionType || q.question_type === f.questionType)
  );
}

// Filter choices for staff: only what published questions actually cover.
async function staffOptions() {
  const live = await liveDocuments();
  const pool = await servablePool(live);
  const documents = new Map();
  for (const q of pool) {
    const key = core.docKeyOf(q.document_id);
    const d = documents.get(key) || {
      docKey: key,
      name: q.source_document_name,
      count: 0,
      topics: new Map(),
    };
    d.count += 1;
    d.topics.set(q.topic, (d.topics.get(q.topic) || 0) + 1);
    documents.set(key, d);
  }
  return {
    total: pool.length,
    documents: [...documents.values()].map((d) => ({
      docKey: d.docKey,
      name: d.name,
      count: d.count,
      topics: [...d.topics.entries()]
        .map(([topic, count]) => ({ topic, count }))
        .sort((a, b) => a.topic.localeCompare(b.topic, "ko")),
    })),
    difficulties: Object.entries(core.DIFFICULTY).map(([value, label]) => ({
      value,
      label,
      count: pool.filter((q) => q.difficulty === value).length,
    })),
    questionTypes: Object.entries(core.QUESTION_TYPE).map(([value, label]) => ({
      value,
      label,
      count: pool.filter((q) => q.question_type === value).length,
    })),
    pool: pool.map((q) => ({
      docKey: core.docKeyOf(q.document_id),
      topic: q.topic,
      difficulty: q.difficulty,
      questionType: q.question_type,
    })),
  };
}

async function recentQuestionIds(userId, limit = 60) {
  const rows = await prisma.schat_quiz_answers.findMany({
    where: { user_id: userId },
    orderBy: { answeredAt: "desc" },
    take: limit,
    select: { question_id: true },
  });
  return new Set(rows.map((r) => r.question_id));
}

async function departmentNameOf(userId) {
  const user = await prisma.users.findUnique({
    where: { id: userId },
    include: { department: true },
  });
  return user?.department?.name || null;
}

async function createAttempt(userId, questions, { mode, filters }) {
  const choiceOrders = {};
  for (const q of questions)
    if (q.question_type === "multiple_choice")
      choiceOrders[q.id] = core.shuffle(
        core.parseChoices(q.choices).map((c) => c.id)
      );
  return prisma.schat_quiz_attempts.create({
    data: {
      user_id: userId,
      department_name: await departmentNameOf(userId),
      mode,
      filters: JSON.stringify(filters || {}),
      question_ids: JSON.stringify(questions.map((q) => q.id)),
      choice_orders: JSON.stringify(choiceOrders),
      total: questions.length,
    },
  });
}

/**
 * 퀴즈 시작: random approved questions from the bank. When fewer questions
 * exist than requested, the quiz starts with what there is and says so.
 */
async function startAttempt(userId, input = {}) {
  const requested = Math.min(
    core.MAX_COUNT,
    Math.max(1, Number.parseInt(input.count, 10) || 10)
  );
  const filters = {
    docKey: input.docKey || "",
    topic: input.topic || "",
    difficulty: core.DIFFICULTY[input.difficulty] ? input.difficulty : "",
    questionType: core.QUESTION_TYPE[input.questionType]
      ? input.questionType
      : "",
  };
  const live = await liveDocuments();
  const pool = (await servablePool(live)).filter((q) =>
    matchesFilters(q, filters)
  );
  if (pool.length === 0)
    throw userError("선택한 조건에 맞는 공개 문제가 없습니다.");
  const picked = core.pickQuestions(
    pool,
    requested,
    await recentQuestionIds(userId)
  );
  const attempt = await createAttempt(userId, picked, {
    mode: "normal",
    filters: { ...filters, requested },
  });
  return {
    attemptId: attempt.id,
    total: picked.length,
    requested,
    notice:
      picked.length < requested
        ? `현재 ${picked.length}문항이 준비되어 있습니다. ${picked.length}문항으로 진행합니다.`
        : null,
  };
}

async function ownAttempt(userId, attemptId) {
  const attempt = await prisma.schat_quiz_attempts.findUnique({
    where: { id: Number(attemptId) },
  });
  // Another person's attempt looks exactly like a missing one.
  if (!attempt || attempt.user_id !== userId)
    throw userError("퀴즈를 찾을 수 없습니다.");
  return attempt;
}

// 직원에게 보이는 문제: 지금 있는 문서의 문제만. 이전 문서가 된 문제는
// 문제·오답노트·풀이 기록 어디에도 보이지 않고 점수 계산에서도 빠진다.
async function visibleQuestions(ids, live) {
  const rows = await prisma.schat_quiz_questions.findMany({
    where: { id: { in: ids }, status: { not: "deleted" } },
  });
  return new Map(
    rows.filter((q) => live.has(q.document_id)).map((q) => [q.id, q])
  );
}

function visibleProgress(ids, byId, answers) {
  const shown = ids.filter((id) => byId.has(id));
  const answered = answers.filter((a) => byId.has(a.question_id));
  const correct = answered.filter((a) => a.is_correct).length;
  return {
    ids: shown,
    total: shown.length,
    answered: answered.length,
    correct,
    completed: shown.length > 0 && answered.length >= shown.length,
    score: core.scoreOf(correct, shown.length),
  };
}

async function attemptView(userId, attemptId) {
  const attempt = await ownAttempt(userId, attemptId);
  const ids = JSON.parse(attempt.question_ids || "[]");
  const orders = JSON.parse(attempt.choice_orders || "{}");
  const live = await liveDocuments();
  const byId = await visibleQuestions(ids, live);
  const answers = await prisma.schat_quiz_answers.findMany({
    where: { attempt_id: attempt.id },
  });
  const answerById = new Map(answers.map((a) => [a.question_id, a]));
  const progress = visibleProgress(ids, byId, answers);
  return {
    id: attempt.id,
    mode: attempt.mode,
    status:
      attempt.status === "completed" || progress.completed
        ? "completed"
        : attempt.status,
    total: progress.total,
    answered: progress.answered,
    correct: progress.correct,
    score:
      attempt.status === "completed" || progress.completed
        ? progress.score
        : attempt.score,
    topic: JSON.parse(attempt.filters || "{}").topic || null,
    questions: progress.ids
      .map((id) => byId.get(id))
      .map((q) => {
        const a = answerById.get(q.id);
        return {
          ...presentStaffQuestion(q, orders[q.id]),
          answer: a
            ? {
                selectedChoiceId: a.selected_choice_id,
                selectedOx: a.selected_ox,
                correct: a.is_correct,
                ...presentReveal(q, live),
              }
            : null,
        };
      }),
  };
}

/**
 * 정답 확인. Judged by choice id (or O/X) against the stored answer; the stored
 * explanation and source are returned. One answer per question per attempt.
 */
async function answerQuestion(userId, attemptId, questionId, input = {}) {
  const attempt = await ownAttempt(userId, attemptId);
  const ids = JSON.parse(attempt.question_ids || "[]");
  const qid = Number(questionId);
  if (!ids.includes(qid)) throw userError("이 퀴즈의 문제가 아닙니다.");
  const liveNow = await liveDocuments({ fresh: true });
  const visible = await visibleQuestions(ids, liveNow);
  const question = visible.get(qid);
  if (!question) throw userError("이 문제는 지금 출제되지 않습니다.");
  const choiceId =
    question.question_type === "multiple_choice" ? input.choiceId : null;
  const ox = question.question_type === "ox" ? input.ox : null;
  if (
    question.question_type === "multiple_choice" &&
    !core.CHOICE_IDS.includes(choiceId)
  )
    throw userError("답을 선택해 주세요.");
  if (question.question_type === "ox" && !["O", "X"].includes(ox))
    throw userError("O 또는 X를 선택해 주세요.");

  const existing = await prisma.schat_quiz_answers.findUnique({
    where: {
      attempt_id_question_id: { attempt_id: attempt.id, question_id: qid },
    },
  });
  let isCorrect = existing?.is_correct;
  if (!existing) {
    isCorrect = core.judge(question, { choiceId, ox });
    const earlier = await prisma.schat_quiz_answers.findMany({
      where: { attempt_id: attempt.id },
    });
    const progress = visibleProgress(ids, visible, [
      ...earlier,
      { question_id: qid, is_correct: isCorrect },
    ]);
    await prisma.$transaction(async (tx) => {
      await tx.schat_quiz_answers.create({
        data: {
          attempt_id: attempt.id,
          question_id: qid,
          user_id: userId,
          selected_choice_id: choiceId,
          selected_ox: ox,
          is_correct: isCorrect,
        },
      });
      const answered = attempt.answered_count + 1;
      const correct = attempt.correct_count + (isCorrect ? 1 : 0);
      const done = answered >= attempt.total || progress.completed;
      await tx.schat_quiz_attempts.update({
        where: { id: attempt.id },
        data: {
          answered_count: answered,
          correct_count: correct,
          ...(done
            ? {
                status: "completed",
                completedAt: new Date(),
                score: progress.score,
              }
            : {}),
        },
      });
      // 오답노트: wrong answers are collected automatically; a later correct
      // answer in "틀린 문제 다시 보기" removes the note.
      if (!isCorrect)
        await tx.schat_quiz_wrong_notes.upsert({
          where: { user_id_question_id: { user_id: userId, question_id: qid } },
          create: {
            user_id: userId,
            question_id: qid,
            selected_choice_id: choiceId,
            selected_ox: ox,
          },
          update: {
            selected_choice_id: choiceId,
            selected_ox: ox,
            wrong_count: { increment: 1 },
            lastWrongAt: new Date(),
          },
        });
      else if (attempt.mode === "wrong_review")
        await tx.schat_quiz_wrong_notes.deleteMany({
          where: { user_id: userId, question_id: qid },
        });
    });
  }
  const after = await prisma.schat_quiz_attempts.findUnique({
    where: { id: attempt.id },
  });
  const now = visibleProgress(
    ids,
    visible,
    await prisma.schat_quiz_answers.findMany({ where: { attempt_id: attempt.id } })
  );
  const completed = after.status === "completed" || now.completed;
  return {
    correct: isCorrect,
    selectedChoiceId: existing ? existing.selected_choice_id : choiceId,
    selectedOx: existing ? existing.selected_ox : ox,
    ...presentReveal(question, liveNow),
    progress: {
      answered: now.answered,
      correct: now.correct,
      total: now.total,
      score: core.scoreOf(now.correct, now.answered),
      completed,
      finalScore: completed ? now.score : null,
    },
  };
}

// 최근 퀴즈 기록: the signed-in user's own completed attempts only. 점수는
// 지금 보이는 문제만으로 다시 계산하고, 보이는 문제가 없는 회차는 숨긴다.
async function history(userId, take = 20) {
  const rows = await prisma.schat_quiz_attempts.findMany({
    where: { user_id: userId, status: "completed" },
    orderBy: { completedAt: "desc" },
  });
  const live = await liveDocuments();
  const answers = await prisma.schat_quiz_answers.findMany({
    where: { attempt_id: { in: rows.map((a) => a.id) } },
  });
  const allIds = [
    ...new Set(rows.flatMap((a) => JSON.parse(a.question_ids || "[]"))),
  ];
  const byId = await visibleQuestions(allIds, live);
  const items = [];
  for (const a of rows) {
    const progress = visibleProgress(
      JSON.parse(a.question_ids || "[]"),
      byId,
      answers.filter((x) => x.attempt_id === a.id)
    );
    if (!progress.total) continue;
    const f = JSON.parse(a.filters || "{}");
    items.push({
      id: a.id,
      completedAt: a.completedAt,
      mode: a.mode,
      topic:
        a.mode === "wrong_review" ? "틀린 문제 다시 보기" : f.topic || "전체",
      score: progress.score,
      correct: progress.correct,
      total: progress.total,
      rate: progress.score,
    });
    if (items.length >= take) break;
  }
  return items;
}

async function wrongNotes(userId) {
  const rows = await prisma.schat_quiz_wrong_notes.findMany({
    where: { user_id: userId },
    include: { question: true },
    orderBy: { lastWrongAt: "desc" },
  });
  const live = await liveDocuments();
  return rows
    .filter((n) => n.question.status !== "deleted" && live.has(n.question.document_id))
    .map((n) => {
      const q = n.question;
      const choices = core.parseChoices(q.choices);
      return {
        id: n.id,
        questionId: q.id,
        question: q.question,
        ...labels(q),
        choices: choices.map((c, i) => ({ ...c, letter: core.LETTERS[i] })),
        selectedChoiceId: n.selected_choice_id,
        selectedOx: n.selected_ox,
        selectedText:
          q.question_type === "ox"
            ? n.selected_ox
            : choices.find((c) => c.id === n.selected_choice_id)?.text || "",
        wrongCount: n.wrong_count,
        lastWrongAt: n.lastWrongAt,
        available: q.status === "approved",
        ...presentReveal(q, live),
      };
    });
}

async function removeWrongNote(userId, noteId) {
  const { count } = await prisma.schat_quiz_wrong_notes.deleteMany({
    where: { id: Number(noteId), user_id: userId },
  });
  if (!count) throw userError("오답노트 항목을 찾을 수 없습니다.");
}

// 틀린 문제 다시 보기: the user's recent wrong answers that are still published.
async function startWrongReview(userId, input = {}) {
  const requested = Math.min(
    core.MAX_COUNT,
    Math.max(1, Number.parseInt(input.count, 10) || 10)
  );
  const live = await liveDocuments();
  const notes = await prisma.schat_quiz_wrong_notes.findMany({
    where: { user_id: userId },
    include: {
      question: { include: { quiz_set: { select: { status: true } } } },
    },
    orderBy: { lastWrongAt: "desc" },
  });
  const questions = notes
    .map((n) => n.question)
    .filter(
      (q) =>
        q.status === "approved" &&
        q.quiz_set?.status !== "inactive" &&
        live.has(q.document_id)
    )
    .slice(0, requested);
  if (questions.length === 0) throw userError("다시 풀 틀린 문제가 없습니다.");
  const attempt = await createAttempt(userId, questions, {
    mode: "wrong_review",
    filters: { requested },
  });
  return {
    attemptId: attempt.id,
    total: questions.length,
    requested,
    notice: null,
  };
}

// ---- admin: bank management (no AI) -----------------------------------------------

async function adminList(filters = {}) {
  const live = await liveDocuments({ fresh: true });
  return (await adminRows(filters, live)).map((q) =>
    presentAdminQuestion(q, live)
  );
}

// Listing and bulk deletion share the same uncapped selection.
async function adminRows(filters, live, db = prisma) {
  const where = {
    status: core.STATUS[filters.status] ? filters.status : { not: "deleted" },
    ...(core.DIFFICULTY[filters.difficulty]
      ? { difficulty: filters.difficulty }
      : {}),
    ...(core.QUESTION_TYPE[filters.questionType]
      ? { question_type: filters.questionType }
      : {}),
    ...(filters.topic ? { topic: String(filters.topic) } : {}),
    ...(filters.quizSetId ? { quiz_set_id: Number(filters.quizSetId) } : {}),
    ...(filters.q ? { question: { contains: String(filters.q) } } : {}),
  };
  const rows = await db.schat_quiz_questions.findMany({
    where,
    include: { quiz_set: { select: { title: true } } },
    orderBy: { id: "desc" },
  });
  return rows
    .filter(
      (q) => !filters.docKey || core.docKeyOf(q.document_id) === filters.docKey
    )
    .filter((q) => {
      const state =
        filters.documentState ||
        (filters.outdated === "1" ? "outdated" : "all");
      return state === "outdated"
        ? !live.has(q.document_id)
        : state === "current"
          ? live.has(q.document_id)
          : true;
    });
}

async function adminDocuments() {
  const live = await liveDocuments({ fresh: true });
  return [...live.values()].map((d) => ({
    docKey: d.docKey,
    name: d.title,
    version: d.version,
    pages: d.pages.size,
    maxPage: Math.max(0, ...d.pages),
  }));
}

async function adminQuestion(id) {
  const q = await prisma.schat_quiz_questions.findUnique({
    where: { id: Number(id) },
    include: { quiz_set: { select: { title: true } } },
  });
  if (!q || q.status === "deleted") throw userError("문제를 찾을 수 없습니다.");
  return presentAdminQuestion(q, await liveDocuments());
}

// 문제 수정. A changed source page must exist in the question's own document.
async function adminUpdate(adminId, id, input = {}) {
  const q = await prisma.schat_quiz_questions.findUnique({
    where: { id: Number(id) },
  });
  if (!q || q.status === "deleted")
    throw userError("삭제된 문제이거나 문제를 찾을 수 없습니다.");
  const check = core.validateQuestionInput({
    ...input,
    questionType: q.question_type,
  });
  if (!check.ok) throw userError(check.errors[0]);
  const live = await liveDocuments({ fresh: true });
  const doc = live.get(q.document_id);
  if (check.value.source_page !== q.source_page) {
    if (!doc)
      throw userError(
        "이전 문서 기반 문제라 출처 쪽을 바꿀 수 없습니다. 현재 문서로 새 문제를 만들어 주세요."
      );
    if (!doc.pages.has(check.value.source_page))
      throw userError(
        `${doc.title}에 ${check.value.source_page}쪽이 없습니다. 출처 쪽을 확인해 주세요.`
      );
  }
  const { question_type: _t, ...data } = check.value;
  const { count } = await prisma.schat_quiz_questions.updateMany({
    where: { id: q.id, status: { not: "deleted" } },
    data: {
      ...data,
      // An edited question's old excerpt no longer fits a new page.
      ...(check.value.source_page !== q.source_page
        ? { source_excerpt: null, source_section: null }
        : {}),
      review_note: input.keepReviewNote ? q.review_note : null,
      updated_by: adminId,
      updatedAt: new Date(),
    },
  });
  if (!count)
    throw userError(
      "삭제된 문제이거나 문제 상태가 바뀌었습니다. 다시 확인해 주세요."
    );
  return adminQuestion(q.id);
}

async function setStatus(adminId, ids = [], status) {
  if (!core.STATUS[status]) throw userError("상태를 확인해 주세요.");
  const list = questionIds(ids);
  return prisma.$transaction(async (tx) => {
    const selected = await tx.schat_quiz_questions.findMany({
      where: { id: { in: list }, status: { not: "deleted" } },
    });
    if (selected.length !== list.length)
      throw userError(
        "삭제된 문제이거나 문제 상태가 바뀌었습니다. 다시 확인해 주세요."
      );
    if (status === "approved") {
      const live = await liveDocuments({ fresh: true, db: tx });
      if (selected.some((r) => !live.has(r.document_id)))
        throw userError("이전 문서 기반 문제는 공개할 수 없습니다.");
    }
    const { count } = await tx.schat_quiz_questions.updateMany({
      where: { id: { in: list }, status: { not: "deleted" } },
      data: { status, updated_by: adminId, updatedAt: new Date() },
    });
    if (count !== list.length)
      throw userError(
        "삭제된 문제이거나 문제 상태가 바뀌었습니다. 다시 확인해 주세요."
      );
    // Publishing a question also publishes its set if the set was still a
    // draft. A set the admin stopped (사용중지) stays stopped.
    if (status === "approved") {
      const sets = await tx.schat_quiz_questions.findMany({
        where: {
          id: { in: list },
          status: "approved",
          quiz_set_id: { not: null },
        },
        select: { quiz_set_id: true },
        distinct: ["quiz_set_id"],
      });
      if (sets.length)
        await tx.schat_quiz_sets.updateMany({
          where: {
            id: { in: sets.map((s) => s.quiz_set_id) },
            status: "draft",
          },
          data: { status: "approved", updatedAt: new Date() },
        });
    }
    return { count };
  });
}

function questionIds(ids) {
  if (
    !Array.isArray(ids) ||
    !ids.length ||
    ids.some((id) => !Number.isSafeInteger(Number(id)) || Number(id) <= 0)
  )
    throw userError("문제를 선택해 주세요.");
  return [...new Set(ids.map(Number))];
}

// 삭제 대상 확인: 이전 문서 전체 삭제는 지금 목록과 같은 대상인지 확인한다.
async function deleteTargets(list, filters, tx) {
  if (filters) {
    if (filters.documentState !== "outdated")
      throw userError("이전 문서 삭제 대상을 다시 확인해 주세요.");
    const live = await liveDocuments({ fresh: true, db: tx });
    const targets = await adminRows(filters, live, tx);
    if (
      targets.length !== list.length ||
      targets.some((q) => !list.includes(q.id))
    )
      throw userError(
        "삭제 대상이 바뀌었습니다. 목록을 새로 불러온 뒤 다시 확인해 주세요."
      );
  }
  const found = await tx.schat_quiz_questions.findMany({
    where: { id: { in: list } },
    select: { id: true },
  });
  if (found.length !== list.length)
    throw userError(
      "삭제 대상이 바뀌었습니다. 목록을 새로 불러온 뒤 다시 확인해 주세요."
    );
  const answers = await tx.schat_quiz_answers.count({
    where: { question_id: { in: list } },
  });
  const wrongNotes = await tx.schat_quiz_wrong_notes.count({
    where: { question_id: { in: list } },
  });
  return { questions: list.length, answers, wrongNotes };
}

async function deletePreview(ids = [], { filters = null } = {}) {
  const list = questionIds(ids);
  return prisma.$transaction((tx) => deleteTargets(list, filters, tx));
}

// 삭제: 문제와 그 문제의 직원 풀이 기록·오답노트를 바로 완전히 지운다.
// 되살리기나 별도 보관은 없다. 퀴즈가 아닌 자료는 건드리지 않는다.
async function deleteQuestions(
  ids = [],
  { filters = null, expected = null } = {}
) {
  const list = questionIds(ids);
  return prisma.$transaction(async (tx) => {
    const counts = await deleteTargets(list, filters, tx);
    if (
      !expected ||
      Number(expected.answers) !== counts.answers ||
      Number(expected.wrongNotes) !== counts.wrongNotes
    )
      throw userError(
        "지울 기록 수가 바뀌었습니다. 확인 창을 닫고 다시 시도해 주세요."
      );
    const removed = new Set(list);
    const attempts = (
      await tx.schat_quiz_attempts.findMany({
        select: { id: true, question_ids: true, status: true, completedAt: true },
      })
    ).filter((a) =>
      JSON.parse(a.question_ids || "[]").some((id) => removed.has(id))
    );
    await tx.schat_quiz_answers.deleteMany({ where: { question_id: { in: list } } });
    await tx.schat_quiz_wrong_notes.deleteMany({ where: { question_id: { in: list } } });
    await tx.schat_quiz_questions.deleteMany({ where: { id: { in: list } } });
    // 삭제한 문제가 들어 있던 풀이 회차는 남은 문제로 점수를 다시 맞춘다.
    for (const a of attempts) {
      const rest = JSON.parse(a.question_ids || "[]").filter((id) => !removed.has(id));
      if (!rest.length) {
        await tx.schat_quiz_attempts.deleteMany({ where: { id: a.id } });
        continue;
      }
      const left = await tx.schat_quiz_answers.findMany({
        where: { attempt_id: a.id },
        select: { is_correct: true },
      });
      const correct = left.filter((x) => x.is_correct).length;
      const done = left.length >= rest.length;
      await tx.schat_quiz_attempts.update({
        where: { id: a.id },
        data: {
          question_ids: JSON.stringify(rest),
          total: rest.length,
          answered_count: left.length,
          correct_count: correct,
          ...(done
            ? {
                status: "completed",
                completedAt: a.completedAt || new Date(),
                score: core.scoreOf(correct, rest.length),
              }
            : {}),
        },
      });
    }
    return counts;
  });
}

async function adminSets() {
  const live = await liveDocuments();
  const sets = await prisma.schat_quiz_sets.findMany({
    include: { questions: { select: { status: true } } },
    orderBy: { id: "desc" },
  });
  return sets.map((s) => ({
    id: s.id,
    title: s.title,
    documentName: s.source_document_name,
    documentVersion: s.document_version,
    outdated: !live.has(s.document_id),
    topic: s.topic,
    difficulty: s.difficulty,
    difficultyLabel: core.DIFFICULTY[s.difficulty] || s.difficulty,
    questionType: s.question_type,
    questionTypeLabel: core.QUESTION_TYPE[s.question_type] || s.question_type,
    status: s.status,
    statusLabel: core.STATUS[s.status] || s.status,
    questions: s.questions.filter((q) => q.status !== "deleted").length,
    approved: s.questions.filter((q) => q.status === "approved").length,
    draft: s.questions.filter((q) => q.status === "draft").length,
    createdAt: s.createdAt,
  }));
}

async function updateSet(id, input = {}) {
  const set = await prisma.schat_quiz_sets.findUnique({
    where: { id: Number(id) },
  });
  if (!set) throw userError("퀴즈 세트를 찾을 수 없습니다.");
  const data = { updatedAt: new Date() };
  if (input.title !== undefined) {
    const title = core.clean(input.title, 80);
    if (!title) throw userError("퀴즈명을 입력해 주세요.");
    data.title = title;
  }
  if (input.status !== undefined) {
    if (!core.STATUS[input.status]) throw userError("상태를 확인해 주세요.");
    data.status = input.status;
  }
  await prisma.schat_quiz_sets.update({ where: { id: set.id }, data });
  return { id: set.id };
}

async function usageToday() {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const rows = await prisma.schat_quiz_generation_logs.findMany({
    where: { createdAt: { gte: start } },
    select: { status: true, created_count: true },
  });
  return {
    requests: rows.length,
    succeeded: rows.filter((r) => r.status === "ok").length,
    questionsCreated: rows.reduce((s, r) => s + r.created_count, 0),
  };
}

// ---- admin statistics (aggregates only; no individual results) --------------------

async function adminStats() {
  let answers = await prisma.schat_quiz_answers.findMany({
    select: { question_id: true, is_correct: true, attempt_id: true },
  });
  // 이전 문서가 된 문제의 풀이는 통계에서 뺀다(지운 문제는 기록도 없음).
  const live = await liveDocuments({ fresh: true });
  const questions = (
    await prisma.schat_quiz_questions.findMany({
      where: { status: { not: "deleted" } },
      select: {
        id: true,
        question: true,
        topic: true,
        document_id: true,
        source_document_name: true,
        source_page: true,
      },
    })
  ).filter((q) => live.has(q.document_id));
  const byId = new Map(questions.map((q) => [q.id, q]));
  const allAnswers = answers;
  answers = allAnswers.filter((a) => byId.has(a.question_id));
  const perQuestion = core
    .questionStats(answers)
    .map((s) => ({ ...s, ...(byId.get(s.questionId) || {}) }))
    .filter((s) => s.question)
    .map((s) => ({
      questionId: s.questionId,
      question: s.question,
      topic: s.topic,
      documentName: s.source_document_name,
      page: s.source_page,
      answers: s.total,
      rate: s.rate,
    }));
  const topicMap = new Map();
  for (const a of answers) {
    const topic = byId.get(a.question_id)?.topic;
    if (!topic) continue;
    const t = topicMap.get(topic) || { total: 0, correct: 0 };
    t.total += 1;
    if (a.is_correct) t.correct += 1;
    topicMap.set(topic, t);
  }
  const completed = await prisma.schat_quiz_attempts.findMany({
    where: { status: "completed" },
    select: {
      id: true,
      user_id: true,
      department_name: true,
      score: true,
      correct_count: true,
      total: true,
    },
  });
  // 이전 문서 문제가 들어 있던 회차는 그 문제를 뺀 점수로 다시 계산한다.
  const removedByAttempt = new Map();
  for (const a of allAnswers) {
    if (byId.has(a.question_id)) continue;
    const r = removedByAttempt.get(a.attempt_id) || { total: 0, correct: 0 };
    r.total += 1;
    if (a.is_correct) r.correct += 1;
    removedByAttempt.set(a.attempt_id, r);
  }
  const attempts = completed
    .map((a) => {
      const r = removedByAttempt.get(a.id);
      if (!r) return a;
      const total = a.total - r.total;
      const correct = a.correct_count - r.correct;
      return { ...a, total, correct_count: correct, score: core.scoreOf(correct, total) };
    })
    .filter((a) => a.total > 0);
  const answersByAttempt = new Map();
  for (const a of answers) {
    const list = answersByAttempt.get(a.attempt_id) || [];
    list.push({ ...a, topic: byId.get(a.question_id)?.topic });
    answersByAttempt.set(a.attempt_id, list);
  }
  return {
    ok: true,
    minRespondents: core.MIN_DEPARTMENT_RESPONDENTS,
    excludedOutdatedAnswers: allAnswers.length - answers.length,
    totals: {
      completedAttempts: attempts.length,
      answers: answers.length,
      rate: core.scoreOf(
        answers.filter((a) => a.is_correct).length,
        answers.length
      ),
    },
    // Questions with at least 3 answers, lowest accuracy first.
    mostMissed: perQuestion
      .filter((q) => q.answers >= 3)
      .sort((a, b) => a.rate - b.rate || b.answers - a.answers)
      .slice(0, 20),
    perQuestion: perQuestion.sort((a, b) => a.questionId - b.questionId),
    topics: [...topicMap.entries()]
      .map(([topic, t]) => ({
        topic,
        answers: t.total,
        rate: core.scoreOf(t.correct, t.total),
      }))
      .sort((a, b) => a.rate - b.rate),
    departments: core.departmentStats(attempts, answersByAttempt),
  };
}

// ---- 문서 새 버전: 근거 문장이 그대로인 퀴즈는 새 버전에 이어 붙인다 ----------

/**
 * 같은 이름의 문서가 새 버전으로 바뀐 직후 호출한다(AI 없음, 글자 비교).
 * 근거 문장이 새 버전에 그대로 있으면 문제를 새 문서에 연결하고(직원 기록
 * 유지), 숫자가 바뀌었거나 찾지 못하면 이전 문서로 남긴다.
 * updates: [{ oldDocumentIds, documentId, title, version, workspaceSlug,
 *             pages: [{ page, text }] }]
 */
async function relinkAfterDocumentUpdate(updates = [], { db = rootPrisma } = {}) {
  const summary = { total: 0, kept: 0, outdated: 0, changed: 0, missing: 0 };
  // 실제 DB에서는 퀴즈 쓰기 잠금 안에서 바꿔 풀이 제출과 겹치지 않게 한다.
  const run = (work) =>
    db === rootPrisma ? withQuizWrite(work) : db.$transaction(work);
  await run(async (tx) => {
    for (const update of updates) {
      const oldIds = [...new Set(update.oldDocumentIds || [])].filter(Boolean);
      if (!oldIds.length || !update.documentId) continue;
      const questions = await tx.schat_quiz_questions.findMany({
        where: { document_id: { in: oldIds }, status: { not: "deleted" } },
        select: { id: true, quiz_set_id: true, source_excerpt: true },
      });
      const keptSets = new Set();
      for (const q of questions) {
        summary.total += 1;
        const result = core.compareEvidence(q.source_excerpt || "", update.pages);
        if (result.status !== "same") {
          summary.outdated += 1;
          summary[result.status] += 1;
          continue;
        }
        summary.kept += 1;
        if (q.quiz_set_id) keptSets.add(q.quiz_set_id);
        await tx.schat_quiz_questions.update({
          where: { id: q.id },
          data: {
            document_id: update.documentId,
            document_version: update.version ?? null,
            workspace_slug: update.workspaceSlug ?? undefined,
            source_page: result.page,
            updatedAt: new Date(),
          },
        });
      }
      if (keptSets.size)
        await tx.schat_quiz_sets.updateMany({
          where: { id: { in: [...keptSets] }, document_id: { in: oldIds } },
          data: {
            document_id: update.documentId,
            document_version: update.version ?? null,
            updatedAt: new Date(),
          },
        });
    }
  });
  liveCache = null;
  return summary;
}

module.exports = {
  withQuizWrite,
  relinkAfterDocumentUpdate,
  userError,
  liveDocuments,
  documentByKey,
  staffOptions,
  startAttempt: (...args) => withQuizWrite(() => startAttempt(...args)),
  attemptView,
  answerQuestion: (...args) => withQuizWrite(() => answerQuestion(...args)),
  history,
  wrongNotes,
  removeWrongNote: (...args) => withQuizWrite(() => removeWrongNote(...args)),
  startWrongReview: (...args) => withQuizWrite(() => startWrongReview(...args)),
  adminList,
  adminDocuments,
  adminQuestion,
  adminUpdate: (...args) => withQuizWrite(() => adminUpdate(...args)),
  setStatus: (...args) => withQuizWrite(() => setStatus(...args)),
  deleteQuestions: (...args) => withQuizWrite(() => deleteQuestions(...args)),
  deletePreview,
  adminSets,
  updateSet: (...args) => withQuizWrite(() => updateSet(...args)),
  usageToday,
  adminStats,
  presentAdminQuestion,
};
