// SCHAT 지침서 퀴즈 - pure helpers (no database, no network, no AI).
const crypto = require("node:crypto");

const DIFFICULTY = {
  beginner: "초급",
  intermediate: "중급",
  advanced: "고급",
};
const QUESTION_TYPE = { multiple_choice: "객관식", ox: "OX" };
const STATUS = { draft: "작성중", approved: "공개", inactive: "사용중지" };
const CHOICE_IDS = ["c1", "c2", "c3", "c4"];
const LETTERS = ["A", "B", "C", "D"];
const MAX_COUNT = 30;
// Departments with fewer respondents than this never show an average.
const MIN_DEPARTMENT_RESPONDENTS = 5;

const clean = (value, max = 1000) =>
  String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);

// Opaque document key for the browser; document ids stay on the server.
function docKeyOf(documentId) {
  return crypto
    .createHash("sha256")
    .update(`schat-quiz-document:${documentId}`)
    .digest("hex")
    .slice(0, 16);
}

function toChoices(texts = []) {
  return texts.map((text, i) => ({
    id: CHOICE_IDS[i],
    text: clean(text, 300),
  }));
}

function parseChoices(raw) {
  if (Array.isArray(raw)) return raw;
  try {
    const list = JSON.parse(raw || "[]");
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

/**
 * Checks a question as the admin saves it. Multiple choice keeps its answer as
 * a choice id ("c1".."c4") so shuffling the display order never changes the
 * correct answer; OX keeps "O" | "X" in its own field.
 */
function validateQuestionInput(input = {}) {
  const errors = [];
  const type = input.questionType;
  if (!QUESTION_TYPE[type]) errors.push("문제 유형을 확인해 주세요.");
  if (!DIFFICULTY[input.difficulty]) errors.push("난이도를 확인해 주세요.");
  const question = clean(input.question, 500);
  if (!question) errors.push("문제를 입력해 주세요.");
  const explanation = String(input.explanation ?? "")
    .trim()
    .slice(0, 2000);
  if (!explanation) errors.push("해설을 입력해 주세요.");
  const topic = clean(input.topic, 60);
  if (!topic) errors.push("주제를 입력해 주세요.");
  const page = Number(input.sourcePage);
  if (!Number.isInteger(page) || page < 1)
    errors.push("출처 쪽 번호를 확인해 주세요.");

  const out = {
    question,
    explanation,
    topic,
    difficulty: input.difficulty,
    question_type: type,
    source_page: page,
    choices: null,
    correct_choice_id: null,
    correct_ox: null,
  };
  if (type === "multiple_choice") {
    const texts = (input.choices || []).map((c) =>
      clean(typeof c === "string" ? c : c?.text, 300)
    );
    if (texts.length !== 4 || texts.some((t) => !t))
      errors.push("선택지 4개를 모두 입력해 주세요.");
    else if (new Set(texts).size !== 4)
      errors.push("선택지가 서로 달라야 합니다.");
    if (!CHOICE_IDS.includes(input.correctChoiceId))
      errors.push("정답 선택지를 골라 주세요.");
    out.choices = JSON.stringify(toChoices(texts));
    out.correct_choice_id = input.correctChoiceId;
  } else if (type === "ox") {
    if (!["O", "X"].includes(input.correctOx))
      errors.push("정답(O 또는 X)을 골라 주세요.");
    out.correct_ox = input.correctOx;
  }
  return { ok: errors.length === 0, errors, value: out };
}

function judge(question, { choiceId = null, ox = null } = {}) {
  if (question.question_type === "ox")
    return ["O", "X"].includes(ox) && ox === question.correct_ox;
  return (
    CHOICE_IDS.includes(choiceId) && choiceId === question.correct_choice_id
  );
}

function shuffle(list, rng = Math.random) {
  const copy = [...list];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

/**
 * Random questions from the bank. Questions the user answered recently go to
 * the back so they come up less often, but are still used when the bank is
 * small.
 */
function pickQuestions(pool = [], count = 10, recentIds = new Set(), rng) {
  const fresh = shuffle(
    pool.filter((q) => !recentIds.has(q.id)),
    rng
  );
  const recent = shuffle(
    pool.filter((q) => recentIds.has(q.id)),
    rng
  );
  return [...fresh, ...recent].slice(0, Math.max(0, count));
}

function scoreOf(correct, total) {
  return total > 0 ? Math.round((correct / total) * 100) : 0;
}

// ---- AI output checks (used by the generation service) ---------------------

const NUMBER_PATTERN = /\d+(?:[.,]\d+)?/g;
const normalizeForMatch = (text = "") =>
  String(text)
    .replace(/\s+/g, "")
    .replace(/[‐-―−]/g, "-");

// Numbers in the answer/explanation that do not appear on the cited page.
function unsupportedNumbers(text, pageText) {
  const page = normalizeForMatch(pageText);
  return [...new Set(String(text).match(NUMBER_PATTERN) || [])].filter(
    (n) => !page.includes(n.replace(",", "")) && !page.includes(n)
  );
}

/**
 * Validates one generated item against the evidence that was sent. Returns
 * null when the item cannot be used at all; otherwise the row plus review
 * warnings for the admin.
 */
function checkGeneratedItem(item = {}, { type, evidenceByPage }) {
  const page = Number(item.sourcePage);
  const pageText = evidenceByPage.get(page);
  if (!pageText) return null; // cites a page that was not provided
  const question = clean(item.question, 500);
  const explanation = String(item.explanation ?? "")
    .trim()
    .slice(0, 2000);
  if (!question || !explanation) return null;

  const row = {
    question,
    explanation,
    source_page: page,
    question_type: type,
    choices: null,
    correct_choice_id: null,
    correct_ox: null,
  };
  let answerText = "";
  if (type === "multiple_choice") {
    const texts = (item.choices || []).map((c) => clean(c, 300));
    if (
      texts.length !== 4 ||
      texts.some((t) => !t) ||
      new Set(texts).size !== 4
    )
      return null;
    const index = Number(item.correctIndex);
    if (!Number.isInteger(index) || index < 0 || index > 3) return null;
    row.choices = JSON.stringify(toChoices(texts));
    row.correct_choice_id = CHOICE_IDS[index];
    answerText = texts[index];
  } else {
    if (!["O", "X"].includes(item.oxAnswer)) return null;
    row.correct_ox = item.oxAnswer;
  }

  const warnings = [];
  const numbers = unsupportedNumbers(
    `${question} ${answerText} ${explanation}`,
    pageText
  );
  if (numbers.length)
    warnings.push(`근거 쪽에 없는 숫자: ${numbers.slice(0, 5).join(", ")}`);
  const quote = clean(item.evidenceQuote, 600);
  const quoteFound =
    quote && normalizeForMatch(pageText).includes(normalizeForMatch(quote));
  if (!quoteFound) warnings.push("근거 문장을 원문에서 찾지 못했습니다.");
  row.source_excerpt = quoteFound ? quote : clean(pageText, 600);
  row.review_note = warnings.length ? warnings.join(" / ") : null;
  return row;
}

// ---- statistics --------------------------------------------------------------

function questionStats(answers = []) {
  const byQuestion = new Map();
  for (const a of answers) {
    const s = byQuestion.get(a.question_id) || { total: 0, correct: 0 };
    s.total += 1;
    if (a.is_correct) s.correct += 1;
    byQuestion.set(a.question_id, s);
  }
  return [...byQuestion.entries()].map(([questionId, s]) => ({
    questionId,
    total: s.total,
    correct: s.correct,
    rate: scoreOf(s.correct, s.total),
  }));
}

/**
 * Department averages from completed attempts. No individual rows or ranking;
 * departments with fewer than MIN_DEPARTMENT_RESPONDENTS distinct people only
 * show that the number is too small.
 */
function departmentStats(attempts = [], answersByAttempt = new Map()) {
  const groups = new Map();
  for (const a of attempts) {
    const name = a.department_name || "부서 없음";
    const g = groups.get(name) || {
      users: new Set(),
      attempts: 0,
      scoreSum: 0,
      correct: 0,
      total: 0,
      topicWrong: new Map(),
    };
    g.users.add(a.user_id);
    g.attempts += 1;
    g.scoreSum += a.score || 0;
    g.correct += a.correct_count;
    g.total += a.total;
    for (const ans of answersByAttempt.get(a.id) || [])
      if (!ans.is_correct && ans.topic)
        g.topicWrong.set(ans.topic, (g.topicWrong.get(ans.topic) || 0) + 1);
    groups.set(name, g);
  }
  return [...groups.entries()]
    .map(([department, g]) => {
      const enough = g.users.size >= MIN_DEPARTMENT_RESPONDENTS;
      return {
        department,
        respondents: enough ? g.users.size : null,
        enough,
        attempts: enough ? g.attempts : null,
        averageScore: enough ? Math.round(g.scoreSum / g.attempts) : null,
        averageRate: enough ? scoreOf(g.correct, g.total) : null,
        mostWrongTopics: enough
          ? [...g.topicWrong.entries()]
              .sort((x, y) => y[1] - x[1])
              .slice(0, 3)
              .map(([topic, count]) => ({ topic, count }))
          : [],
      };
    })
    .sort((a, b) => a.department.localeCompare(b.department, "ko"));
}

module.exports = {
  DIFFICULTY,
  QUESTION_TYPE,
  STATUS,
  CHOICE_IDS,
  LETTERS,
  MAX_COUNT,
  MIN_DEPARTMENT_RESPONDENTS,
  clean,
  docKeyOf,
  toChoices,
  parseChoices,
  validateQuestionInput,
  judge,
  shuffle,
  pickQuestions,
  scoreOf,
  unsupportedNumbers,
  checkGeneratedItem,
  questionStats,
  departmentStats,
};
