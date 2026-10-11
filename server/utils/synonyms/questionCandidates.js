// 직원 질문 후보의 순수 검사와 호출 예약. 실제 AI/예약 작업 연결은 별도 경계에서 수행한다.
const { randomUUID } = require("node:crypto");
const { termKey, validateSynonymGroup } = require("./index");
const { containsPrivateInfo } = require("./suggestions");
const LABEL = "schat_question_synonym_budget_v1";
const STOP = new Set([
  "알려줘",
  "알려주세요",
  "어떻게",
  "확인",
  "확인해",
  "해주세요",
  "무엇",
  "무슨",
  "하는",
  "방법",
  "대한",
  "관련",
  "환자",
  "이름",
  "성명",
  "질문",
  "있나요",
]);

function safeExample(prompt) {
  return (
    String(prompt || "")
      .normalize("NFKC")
      .slice(0, 4000)
      // 호칭 뒤 문법을 열거하지 않고 이름+호칭 문맥 전체를 제거한다.
      .replace(
        /(?<![가-힣])[가-힣]{2,4}\s*(?:교수님?|선생님|간호사님?|주치의|과장님?|팀장님?|담당자|환자(?:분)?|님|씨)[가-힣]*/gu,
        "[이름]"
      )
      // 성씨 목록에 없는 이름도 제외한다. 짧은 의료 표현의 보수적 누락은 허용한다.
      .replace(
        /(?<![가-힣])((?:성명|이름|환자)\s*[:：]?\s*)[가-힣]{2,4}/gu,
        "$1[이름]"
      )
      .replace(/\d{2,4}\s*(?:호실|호)(?![가-힣])/g, "[병실]")
      .replace(/\b\d{2,4}[- )]\d{3,4}[- ]\d{4}\b/g, "[번호]")
      .replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, "[연락처]")
      .replace(/\d{5,}/g, "[번호]")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 200)
  );
}

function collectExpressions(rows = []) {
  const seen = new Set();
  const found = new Map();
  for (const row of rows) {
    if (!Number.isSafeInteger(Number(row.id)) || seen.has(Number(row.id)))
      continue;
    let response;
    try {
      response = JSON.parse(row.response);
    } catch {
      continue;
    }
    if (
      !row.notFound &&
      (!Array.isArray(response?.sources) || response.sources.length)
    )
      continue;
    seen.add(Number(row.id));
    const example = safeExample(row.prompt);
    // Never tokenize a partially masked name, phone or room marker back into words.
    const text = example.replace(/\S*[○*]\S*|\[[^\]]*\]/g, " ");
    const own = new Set();
    for (const raw of text.match(/[가-힣A-Za-z][가-힣A-Za-z0-9-]{1,29}/g) ||
      []) {
      const term = /^[가-힣]{4,}$/.test(raw)
        ? raw.replace(/(?:은|는|을|를|이|가)$/, "")
        : raw;
      const key = termKey(term);
      if (STOP.has(key) || own.has(key) || containsPrivateInfo(term)) continue;
      own.add(key);
      const item = found.get(key) || { term, count: 0, example };
      item.count++;
      found.set(key, item);
    }
  }
  return [...found.values()]
    .filter((item) => item.count >= 2)
    .sort((a, b) => b.count - a.count || a.term.localeCompare(b.term))
    .slice(0, 200);
}

function checkMatches(matches, expressions, snippets, dismissed = []) {
  const blocked = new Set(dismissed.map(termKey));
  const result = [];
  const seen = new Set();
  for (const match of Array.isArray(matches) ? matches : []) {
    if (typeof match?.term !== "string" || typeof match?.target !== "string")
      continue;
    const expression = expressions.find(
      (item) => termKey(item.term) === termKey(match.term)
    );
    const target = match.target.trim();
    const key = termKey(match.term);
    if (
      !expression ||
      expression.count < 2 ||
      seen.has(key) ||
      blocked.has(key) ||
      blocked.has(termKey(target))
    )
      continue;
    if (
      !Number.isFinite(match.confidence) ||
      match.confidence < 0.8 ||
      !["약물", "용어"].includes(match.category) ||
      containsPrivateInfo(target)
    )
      continue;
    const source = snippets.find((item) =>
      termKey(item.text).includes(termKey(target))
    );
    if (!source || target.length < 2 || termKey(target) === key) continue;
    try {
      const checked = validateSynonymGroup({
        terms: [expression.term, target],
        kind: match.category === "약물" ? "drug" : "procedure",
        status: "needs_review",
      });
      result.push({
        ...checked,
        category: match.category === "약물" ? "약물" : "용어",
        confidence: Math.min(1, match.confidence),
        pages: source.page ? [source.page] : [],
        source: {
          type: "staff_questions",
          expression: expression.term,
          count: expression.count,
          example: expression.example,
          documentId: source.documentId,
          pages: source.page ? [source.page] : [],
        },
      });
      seen.add(key);
    } catch {
      /* 서로 반대인 시술 등 위험한 묶음은 제외한다. */
    }
  }
  return result;
}

function createLedger(prisma) {
  async function read(tx = prisma) {
    const row = await tx.system_settings.findUnique({
      where: { label: LABEL },
    });
    if (!row)
      return {
        limit: 20,
        day: null,
        token: null,
        calls: 0,
        status: "idle",
        candidates: 0,
      };
    let value;
    try {
      value = JSON.parse(row.value);
    } catch {
      throw new Error("QUESTION_BUDGET_INVALID");
    }
    if (
      !Number.isInteger(value?.limit) ||
      value.limit < 0 ||
      value.limit > 200 ||
      !Number.isInteger(value.calls) ||
      value.calls < 0 ||
      (value.day != null && !/^\d{4}-\d{2}-\d{2}$/.test(value.day))
    )
      throw new Error("QUESTION_BUDGET_INVALID");
    return value;
  }
  async function write(tx, state) {
    const value = JSON.stringify(state);
    await tx.system_settings.upsert({
      where: { label: LABEL },
      create: { label: LABEL, value },
      update: { value },
    });
  }
  return {
    read,
    async setLimit(limit) {
      if (!Number.isInteger(limit) || limit < 0 || limit > 200)
        throw new Error("INVALID_LIMIT");
      return prisma.$transaction(async (tx) => {
        const state = { ...(await read(tx)), limit };
        await write(tx, state);
        return state;
      });
    },
    async claim(day) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error("INVALID_DAY");
      return prisma.$transaction(async (tx) => {
        const state = await read(tx);
        // Same-day interrupted runs remain claimed: prefer missed work over excess calls.
        if (state.limit === 0 || (state.day && state.day >= day)) return null;
        const token = randomUUID();
        await write(tx, {
          ...state,
          day,
          token,
          calls: 0,
          status: "running",
          candidates: 0,
        });
        return token;
      });
    },
    async reserve(day, token) {
      return prisma.$transaction(async (tx) => {
        const state = await read(tx);
        if (
          state.day !== day ||
          state.token !== token ||
          state.status !== "running" ||
          state.calls >= state.limit
        )
          return false;
        await write(tx, { ...state, calls: state.calls + 1 });
        return true;
      });
    },
    async finish(day, token, status, candidates) {
      if (
        !["done", "failed", "limited"].includes(status) ||
        !Number.isSafeInteger(candidates) ||
        candidates < 0
      )
        throw new Error("INVALID_RESULT");
      return prisma.$transaction(async (tx) => {
        const state = await read(tx);
        if (state.day !== day || state.token !== token) return false;
        await write(tx, { ...state, status, candidates });
        return true;
      });
    },
  };
}

async function runCandidates({ ledger, day, load, ask, save }) {
  const date = day();
  const token = await ledger.claim(date);
  if (!token) return { status: "skipped", candidates: 0 };
  let candidates = 0;
  let status = "done";
  try {
    const { rows, batches, dismissed } = await load();
    const expressions = collectExpressions(rows);
    if (expressions.length) {
      for (const snippets of batches) {
        if (day() !== date || !(await ledger.reserve(date, token))) {
          status = "limited";
          break;
        }
        // No questions, examples or memo fields cross the AI boundary.
        const output = await ask({
          terms: expressions.map((item) => item.term),
          lines: snippets.map((item) => item.text),
        });
        const matches = checkMatches(output, expressions, snippets, dismissed);
        if (matches.length) candidates += await save(matches);
      }
    }
  } catch {
    // Do not persist or log provider/DB exception text, which can echo inputs.
    status = "failed";
  }
  await ledger.finish(date, token, status, candidates);
  return { status, candidates };
}

module.exports = {
  safeExample,
  collectExpressions,
  checkMatches,
  createLedger,
  runCandidates,
};
