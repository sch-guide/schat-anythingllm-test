// SCHAT 관리자 "사용 통계".
// - 관리자만 조회한다 (endpoint에서 권한 확인).
// - "누가"가 아니라 "무엇을" 물었는지만 집계한다. 이름·사번·계정은 응답에 없다.
// - Gemini 등 외부 AI를 호출하지 않는다. 저장된 대화 기록(workspace_chats)만 읽는다.
// - 질문 원문은 응답을 만들 때 환자 정보로 보이는 숫자를 *** 로 가린다.

const { estimateChatCost } = require('../aiUsageFees');
const { readSearchOutcome } = require('../chatSearchOutcome');
const PERIODS = Object.freeze({ today: 1, "7d": 7, "30d": 30, "90d": 90 });
const QUESTION_TEXT_MAX_DAYS = 90;
const MIN_DEPARTMENT_USERS = 5;
const LIST_LIMIT = 100;
const TOPIC_LIMIT = 10;
const CACHE_TTL_MS = 5 * 60 * 1000;
const KST_OFFSET_MS = 9 * 60 * 60 * 1000; // 한국 시간 (서머타임 없음)

// "지침에서 찾을 수 없다"는 취지의 답변 문구.
const NOT_FOUND_PATTERN =
  /확인되지 않습니다|찾을 수 없|찾지 못했|근거(?:를|가)\s*(?:찾지 못|없)|등록된 (?:병원 )?문서에(?:서)? (?:없|확인되지)/u;

/** Hides values that look like patient identifiers. Applied in the API. */
function maskSensitive(text = "") {
  return String(text)
    .replace(/\d{6}\s*-\s*[1-4]\d{6}/g, "***") // 주민등록번호
    .replace(/\b0\d{1,2}[-.\s]?\d{3,4}[-.\s]?\d{4}\b/g, "***") // 전화번호
    .replace(/\d{6,}/g, "***"); // 등록번호처럼 긴 숫자
}

function kstParts(date) {
  const shifted = new Date(new Date(date).getTime() + KST_OFFSET_MS);
  return {
    day: shifted.toISOString().slice(0, 10),
    hour: shifted.getUTCHours(),
  };
}

/** Start of the period: KST midnight (days - 1) days before today. */
function periodStart(period, now = new Date()) {
  const days = PERIODS[period] || PERIODS["7d"];
  const kstMidnight =
    new Date(`${kstParts(now).day}T00:00:00.000Z`).getTime() - KST_OFFSET_MS;
  return new Date(kstMidnight - (days - 1) * 24 * 60 * 60 * 1000);
}

function usageFilters(period, { startDate, endDate, departmentIds = [], now = new Date() } = {}) {
  const invalid = (message) => { const error = new Error(message); error.status = 400; throw error; };
  let since = periodStart(period, now);
  let until = new Date(now.getTime() + 1);
  let days = PERIODS[period] || PERIODS['7d'];
  if (period === 'custom') {
    const parse = (value) => {
      if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) invalid('시작일과 종료일을 선택해 주세요.');
      const date = new Date(`${value}T00:00:00+09:00`);
      if (!Number.isFinite(date.getTime()) || kstParts(date).day !== value) invalid('날짜가 올바르지 않습니다.');
      return date;
    };
    since = parse(startDate);
    until = new Date(parse(endDate).getTime() + 86400000);
    days = (until - since) / 86400000;
    if (days < 1 || days > 366) invalid('종료일은 시작일 이후여야 하며, 한 번에 최대 366일을 조회할 수 있습니다.');
    if (endDate > kstParts(now).day) invalid('미래 날짜는 조회할 수 없습니다.');
  }
  if (!Array.isArray(departmentIds) || departmentIds.length > 100 || departmentIds.some(id => !/^\d+$/.test(String(id)) || !Number.isSafeInteger(Number(id)) || Number(id) <= 0))
    invalid('부서 선택이 올바르지 않습니다.');
  return { since, until, days, departmentIds: [...new Set(departmentIds.map(Number))].sort((a,b)=>a-b) };
}

function parseResponse(value) {
  try {
    const parsed = JSON.parse(value || "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function sourceDocument(source = {}) {
  return String(
    source.documentName || source.document_name || source.title || ""
  )
    .split(/[\\/]/)
    .pop()
    .trim();
}

function topicLabel(source = {}) {
  const document = sourceDocument(source);
  const section = String(source.section || "").trim();
  if (section) return `${document} · ${section}`;
  return source.page ? `${document} · p.${source.page}` : document;
}

const byCountThenName = (a, b) =>
  b.count - a.count || a.name.localeCompare(b.name, "ko");

/**
 * Pure aggregation (tested without a database).
 * chats: [{ prompt, response, user_id, createdAt }]
 * users: [{ id, department_id }], departments: [{ id, name }]
 * documents: names of the registered guideline documents
 */
function computeUsageStats({
  chats = [],
  users = [],
  departments = [],
  documents = [],
  period = "7d",
  now = new Date(),
  startDate,
  endDate,
  departmentIds = [],
} = {}) {
  const filters = usageFilters(period, { startDate, endDate, departmentIds, now });
  const { since, until, days } = filters;
  const selected = new Set(filters.departmentIds);
  if (filters.departmentIds.some(id => !departments.some(d => d.id === id))) {
    const error = new Error('선택한 부서가 없습니다. 부서 목록을 다시 확인해 주세요.');
    error.status = 400;
    throw error;
  }
  const userDepartment = new Map(users.map((u) => [u.id, u.department_id]));
  const textSince = new Date(
    now.getTime() - QUESTION_TEXT_MAX_DAYS * 24 * 60 * 60 * 1000
  );
  const inPeriod = chats.filter(
    (chat) =>
      new Date(chat.createdAt) >= since && new Date(chat.createdAt) < until && new Date(chat.createdAt) <= now &&
      (!selected.size || selected.has(userDepartment.get(chat.user_id)))
  );

  // A department filter must not bypass the existing small-group protection
  // through totals, tokens or question lists in the other cards.
  if (selected.size && filters.departmentIds.some(id => {
    const people = new Set(inPeriod.filter(c => userDepartment.get(c.user_id) === id).map(c => c.user_id));
    return people.size > 0 && people.size < MIN_DEPARTMENT_USERS;
  })) return { period, since: since.toISOString(), suppressed: true,
    message: '선택한 부서 중 조회 기간 사용자가 5명 미만인 부서가 있어 통계를 표시하지 않습니다.' };

  // (1) 질문 수
  const daily = [];
  for (let index = 0; index < days; index += 1) {
    const day = kstParts(new Date(since.getTime() + index * 86400000 + 1)).day;
    daily.push({ date: day, count: 0 });
  }
  const dailyIndex = new Map(daily.map((row, index) => [row.date, index]));
  const hourly = Array.from({ length: 24 }, (_, hour) => ({ hour, count: 0 }));

  const topics = new Map();
  const cited = new Map();
  const searchFailures = [];
  const notFoundAnswers = [];
  let searchFailureCount = 0;
  let notFoundCount = 0;
  const departmentUsage = new Map();
  const departmentName = new Map(departments.map((d) => [d.id, d.name]));
  let promptTokens = 0;
  let completionTokens = 0;
  let chatsWithTokens = 0;

  for (const chat of inPeriod) {
    const { day, hour } = kstParts(chat.createdAt);
    if (dailyIndex.has(day)) daily[dailyIndex.get(day)].count += 1;
    hourly[hour].count += 1;

    const response = parseResponse(chat.response);
    const sources = Array.isArray(response.sources) ? response.sources : [];

    // (2) 주제 / (3) 문서: 한 질문은 주제·문서마다 한 번만 센다.
    for (const label of new Set(sources.map(topicLabel).filter(Boolean)))
      topics.set(label, (topics.get(label) || 0) + 1);
    for (const name of new Set(sources.map(sourceDocument).filter(Boolean)))
      cited.set(name, (cited.get(name) || 0) + 1);

    // 새 기록은 실제 못 찾음만 검색 실패로 센다. 표기 없는 과거 기록은
    // 무출처/근거 없음의 기존 두 목록 분류를 그대로 유지한다.
    const listed = new Date(chat.createdAt) >= textSince;
    const entry = listed && {
      question: maskSensitive(chat.prompt).slice(0, 300),
      date: day,
    };
    const outcome = readSearchOutcome(response);
    if (outcome === 'not_found' || (outcome === null && sources.length === 0)) {
      searchFailureCount += 1;
      if (entry) searchFailures.push(entry);
    } else if (outcome === null && NOT_FOUND_PATTERN.test(String(response.text || ""))) {
      notFoundCount += 1;
      if (entry) notFoundAnswers.push(entry);
    }

    // (6) 부서별: 질문 수와 사용자 수 (사용자 수는 5명 미만 판정에만 사용)
    const departmentId = userDepartment.get(chat.user_id) ?? null;
    const key = departmentId ?? "none";
    const usage = departmentUsage.get(key) || {
      name: departmentName.get(departmentId) || "부서 없음",
      questions: 0,
      users: new Set(),
    };
    usage.questions += 1;
    if (chat.user_id !== null && chat.user_id !== undefined)
      usage.users.add(chat.user_id);
    departmentUsage.set(key, usage);

    // (7) AI 사용량: 저장된 토큰 수만 더한다.
    const metrics = response.metrics || {};
    if (Number.isFinite(metrics.prompt_tokens)) {
      chatsWithTokens += 1;
      promptTokens += metrics.prompt_tokens;
      completionTokens += Number(metrics.completion_tokens) || 0;
    }
  }

  const newestFirst = (a, b) => b.date.localeCompare(a.date);
  const citedDocuments = [...cited]
    .map(([name, count]) => ({ name, count }))
    .sort(byCountThenName);
  const citedNames = new Set(citedDocuments.map((doc) => doc.name));

  return {
    period,
    since: since.toISOString(),
    questions: {
      total: inPeriod.length,
      daily,
      hourly,
    },
    topics: [...topics]
      .map(([name, count]) => ({ name, count }))
      .sort(byCountThenName)
      .slice(0, TOPIC_LIMIT),
    documents: {
      cited: citedDocuments,
      uncited: [...new Set(documents.filter(Boolean))]
        .filter((name) => !citedNames.has(name))
        .sort((a, b) => a.localeCompare(b, "ko")),
    },
    searchFailures: {
      total: searchFailureCount,
      items: searchFailures.sort(newestFirst).slice(0, LIST_LIMIT),
    },
    notFoundAnswers: {
      total: notFoundCount,
      items: notFoundAnswers.sort(newestFirst).slice(0, LIST_LIMIT),
    },
    departments: [...departmentUsage.values()]
      .map((usage) =>
        usage.users.size < MIN_DEPARTMENT_USERS
          ? { name: usage.name, hidden: true }
          : { name: usage.name, hidden: false, questions: usage.questions }
      )
      .sort((a, b) => a.name.localeCompare(b.name, "ko")),
    aiUsage: {
      estimatedCost: estimateChatCost(inPeriod),
      questions: inPeriod.length,
      chatsWithTokens,
      promptTokens,
      completionTokens,
    },
  };
}

// ---- loading (read only) ----------------------------------------------------

const cache = new Map();

async function loadUsageStats(period = "7d", { now = new Date(), startDate, endDate, departmentIds = [] } = {}) {
  period = period === 'custom' || PERIODS[period] ? period : '7d';
  const filters = usageFilters(period, { startDate, endDate, departmentIds, now });
  const key = JSON.stringify([period, startDate, endDate, filters.departmentIds, kstParts(now).day]);
  const cached = cache.get(key);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.body;

  const prisma = require("../prisma");
  const { since, until } = filters;
  const [chats, users, departments, documentRows] = await Promise.all([
    prisma.workspace_chats.findMany({
      where: { createdAt: { gte: since, lt: until } },
      select: { prompt: true, response: true, user_id: true, createdAt: true },
    }),
    prisma.users.findMany({ select: { id: true, department_id: true } }),
    prisma.schat_departments.findMany({ select: { id: true, name: true } }),
    prisma.workspace_documents.findMany({ select: { metadata: true } }),
  ]);
  const documents = documentRows.map((row) => {
    try {
      return String(JSON.parse(row.metadata || "{}").title || "").trim();
    } catch {
      return "";
    }
  });
  const body = {
    ...computeUsageStats({
      chats,
      users,
      departments,
      documents,
      period,
      now,
      startDate,
      endDate,
      departmentIds: filters.departmentIds,
    }),
    availableDepartments: departments.map(({ id, name }) => ({ id, name })).sort((a,b)=>a.name.localeCompare(b.name,'ko')),
    selection: { period, startDate: kstParts(since).day, endDate: period === 'custom' ? endDate : kstParts(now).day, departmentIds: filters.departmentIds },
    generatedAt: now.toISOString(),
  };
  if (cache.size >= 100) cache.clear();
  cache.set(key, { at: Date.now(), body });
  return body;
}

function clearUsageStatsCache() {
  cache.clear();
}

module.exports = {
  PERIODS,
  MIN_DEPARTMENT_USERS,
  maskSensitive,
  periodStart,
  computeUsageStats,
  loadUsageStats,
  clearUsageStatsCache,
};
