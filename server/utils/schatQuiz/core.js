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
// 2026-10-17 사용자 요청: 응답자가 적은 부서도 모두 보여 준다(사용 통계와 같음). 개인별 점수·순위는 여전히 없음.
const MIN_DEPARTMENT_RESPONDENTS = 1;

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
 * every department with at least one respondent is shown (2026-10-17).
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

// ---- 문서 새 버전과 근거 문장 비교 (AI 없이 글자 비교) ---------------------------

// 띄어쓰기·줄바꿈·글머리 기호만 같은 것으로 본다. 숫자·단위·낱말은 그대로 남겨
// 하나라도 다르면 찾지 못하게 한다. 목록 번호(1. 2))도 숫자라서 남긴다.
const BULLETS = /[•●○◦▪▫■□◆◇▶▷►‣⁃∙ㆍ※✓✔❍❑➢➤①-⑳]/gu;
const LETTER_MARKER = /(^|\s)[가-하][.)](?=\s)/gu;
const DASH_MARKER = /(^|\s)[-–—*](?=\s)/gu;
function normalizeEvidence(text = "") {
  return String(text)
    .normalize("NFKC")
    .replace(/[​-‍﻿­]/g, "")
    .replace(LETTER_MARKER, "$1")
    .replace(DASH_MARKER, "$1")
    .replace(BULLETS, "")
    .replace(/[‐-―−]/g, "-")
    .replace(/\s+/g, "")
    .toLowerCase();
}
const numberSkeleton = (text) => text.replace(/\d+(?:[.,]\d+)*/g, "#");

/**
 * 근거 문장이 새 버전 문서에 그대로 있는지 확인한다.
 * pages: [{ page, text }]. 결과 status:
 *   same    - 그대로 있음(page = 찾은 쪽)
 *   changed - 같은 문장인데 숫자가 다름
 *   missing - 찾지 못함(낱말·단위가 바뀌었거나 문장이 없어짐)
 */
function compareEvidence(excerpt, pages = []) {
  const target = normalizeEvidence(excerpt);
  if (target.length < 4) return { status: "missing", page: null };
  const normalized = pages
    .map((p) => ({ page: Number(p.page), text: normalizeEvidence(p.text) }))
    .filter((p) => Number.isInteger(p.page) && p.text)
    .sort((a, b) => a.page - b.page);
  // 숫자로 시작/끝나는 문장은 앞뒤 숫자까지 확인한다("5 mg" ≠ "25 mg").
  const find = (hay, needle) => {
    const digitEdge = (ch) => !!ch && /[\d.,#]/.test(ch);
    for (let at = hay.indexOf(needle); at >= 0; at = hay.indexOf(needle, at + 1)) {
      const before = hay[at - 1];
      const after = hay[at + needle.length];
      if (/[\d#]/.test(needle[0]) && digitEdge(before)) continue;
      if (/[\d#]/.test(needle[needle.length - 1]) && digitEdge(after)) continue;
      return at;
    }
    return -1;
  };
  const locate = (needle, convert = (t) => t) => {
    for (const p of normalized) if (find(convert(p.text), needle) >= 0) return p.page;
    // 쪽 경계에 걸친 문장도 찾는다.
    let joined = "";
    const starts = [];
    for (const p of normalized) {
      starts.push([joined.length, p.page]);
      joined += p.text;
    }
    const at = find(convert(joined), needle);
    if (at < 0) return null;
    let page = normalized[0]?.page ?? null;
    if (convert === numberSkeleton) return page;
    for (const [start, pageNo] of starts) if (start <= at) page = pageNo;
    return page;
  };
  const page = locate(target);
  if (page !== null) return { status: "same", page };
  if (/\d/.test(target) && locate(numberSkeleton(target), numberSkeleton) !== null)
    return { status: "changed", page: null };
  return { status: "missing", page: null };
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
  normalizeEvidence,
  compareEvidence,
};
