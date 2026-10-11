// SCHAT 동의어 자동 후보.
// 문서 등록 → 후보 생성 → "검토 필요" → 관리자 확인 → "사용" → 검색 적용.
//
// 1. 등록된 문서의 쪽마다 제목 줄과 영문·약어가 섞인 짧은 줄만 고른다.
//    PDF 본문 전체는 보내지 않는다. 사람 이름·전화번호·병실·사번처럼 보이는
//    줄은 Gemini 입력에서 뺀다.
// 2. 현재 SCHAT의 Gemini(답변과 같은 설정)에 정해진 JSON 형식으로 묻는다.
// 3. 받은 후보는 보낸 줄에 글자 그대로 있는 단어만 남기고, 삽입·제거처럼
//    서로 다른 동작이 섞이면 버린다.
// 4. 기존 묶음과 비교해 완전히 같으면 만들지 않고, 기존 묶음에 새 단어만
//    있으면 "추가 후보"로만 남긴다. 기존 묶음은 자동으로 바꾸지 않는다.
// 5. 새 묶음은 항상 status "needs_review", source "auto"로 저장한다.
//    검색과 체크리스트는 "active" 묶음만 읽으므로 승인 전에는 쓰이지 않는다.
// 실패해도 문서 등록에는 영향이 없다(시스템 기록만 남김).
// 저장하지 않는 것: 보낸 원문 줄, 프롬프트, Gemini 응답 원문, API 키.
const {
  validateSynonymGroup,
  validateStoredGroup,
  serialized,
  toPublicGroup,
  invalidate,
} = require("./index");

const METHOD = "gemini-titles-v1";
const { createHash } = require("node:crypto");
const activeRetries = new Set();
const MIN_CONFIDENCE = 0.5;
const LOW_CONFIDENCE = 0.7;
const MAX_TERMS = 6;
const MAX_LINE_CHARS = 60;
const BATCH_CHARS = 6000;
const MAX_BATCHES = 30;
const TITLE_LINES_PER_PAGE = 3;
const TERM_LINES_PER_PAGE = 6;

// 문서별 AI 호출·재시도는 순차 처리하되 관리자 저장을 기다리게 하지 않는다.
let generationQueue = Promise.resolve();
function serializeGeneration(task) {
  const run = generationQueue.then(task, task);
  generationQueue = run.catch(() => null);
  return run;
}

const CATEGORIES = Object.freeze(["약물", "용어"]);

const SUGGESTION_SCHEMA = {
  type: "object",
  properties: {
    groups: {
      type: "array",
      items: {
        type: "object",
        properties: {
          terms: { type: "array", items: { type: "string" } },
          category: { type: "string", enum: [...CATEGORIES] },
          confidence: { type: "number" },
          reason: { type: "string" },
          pages: { type: "array", items: { type: "integer" } },
        },
        required: ["terms", "category", "confidence", "reason", "pages"],
        additionalProperties: false,
      },
    },
  },
  required: ["groups"],
  additionalProperties: false,
};

const SYSTEM_PROMPT = [
  "너는 병원 간호 지침서의 제목·용어 줄에서 같은 대상을 가리키는 서로 다른 표기(한글명, 영문명, 약어, 병원 현장에서 흔히 부르는 이름)를 찾아 동의어 후보로 묶는다.",
  "입력은 문서 이름과 'p.쪽번호: 줄' 형식의 짧은 줄뿐이다. PDF에서 뽑은 글이라 띄어쓰기가 빠져 있을 수 있다.",
  "규칙:",
  "1. terms에는 입력 줄에 글자 그대로 들어 있는 표기만 쓴다. 붙어 있는 글자에서 단어를 잘라 쓰는 것은 되지만, 새 단어·철자·번역을 만들지 않는다.",
  "2. 정확히 같은 대상만 묶는다. 다음은 묶지 않는다: 서로 다른 검사·시술·수술, 삽입과 제거 같은 반대 동작, 검사와 치료, 서로 다른 약물(이름이 비슷해도), 서로 다른 카테터·라인 종류, 상위 개념과 그 하위 항목, 여러 뜻으로 쓰일 수 있는 약어.",
  "3. 확실하지 않으면 묶지 않는다. 묶었지만 덜 확실하면 confidence를 0.7 미만으로 적는다.",
  "4. 한 묶음은 2~6개 표기로 한다. 한 표기를 두 묶음에 넣지 않는다. 띄어쓰기나 대소문자만 다른 표기는 같은 단어로 보고 하나만 쓴다.",
  "5. 사람 이름, 전화번호, 병실, 사번 같은 개인 정보는 terms와 reason에 쓰지 않는다.",
  "6. pages에는 그 표기가 나온 쪽 번호를 쓴다. reason은 한국어 한 문장(60자 이내)으로 왜 같은 대상인지 쓴다.",
  "찾은 묶음이 없으면 groups를 빈 배열로 한다.",
].join("\n");

// ---- text helpers -----------------------------------------------------------

function cleanTerm(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(/\s+/g, " ")
    .trim();
}

function termKey(value) {
  return cleanTerm(value).toLowerCase().replace(/\s+/g, "");
}

// Lines that may identify a person. Hospital handbooks are not expected to
// hold patient data, but they do carry staff names ("○○교수님") and
// extension numbers; such lines never reach Gemini.
const PRIVATE_PATTERNS = [
  /\d{6}\s*-\s*[1-4]\d{6}/, // 주민등록번호
  /\d{2,4}\s*[-)]\s*\d{3,4}\s*-\s*\d{4}/, // 전화번호
  /\d{5,}/, // 등록번호·사번처럼 긴 숫자
  /[☎☏✆]/,
  /전화|연락처|연락|내선|휴대폰|핸드폰|이메일|e-?mail|@/i,
  /환자\s*(명|이름|번호)|성\s*명|이름\s*[:：]|주민|생년월일|등록\s*번호|사번|직원\s*번호|병록\s*번호/,
  /병실|호실|\d{2,4}\s*호(?![가-힣A-Za-z])/,
  /교수|선생님|과장님|수간호사|팀장|담당자|주치의|님(?=$|[^가-힣])|님들/,
];

function containsPrivateInfo(text = "") {
  const value = cleanTerm(text);
  return PRIVATE_PATTERNS.some((pattern) => pattern.test(value));
}

function pageLines(text = "") {
  return String(text)
    .split(/\r?\n/)
    .map(cleanTerm)
    .filter((line) => line.length >= 2 && line.length <= MAX_LINE_CHARS);
}

const LATIN = /[A-Za-z]{2,}/;
const HANGUL = /[가-힣]/;

/**
 * Picks the short lines worth sending for one document: page titles
 * (section + first lines) and lines mixing Korean with English names or
 * abbreviations. Lines repeated on many pages (headers, footers) and lines
 * that look personal are dropped. Returns batches of "p.N: line" text.
 */
function collectSnippets(pages = []) {
  const linesByPage = pages
    .filter((page) => page && typeof page.pageContent === "string")
    .map((page) => ({
      page: Number(page.page) || null,
      section: cleanTerm(page.section || ""),
      lines: pageLines(page.pageContent),
    }))
    .sort((a, b) => (a.page || 0) - (b.page || 0));

  const seenOnPages = new Map();
  for (const { lines } of linesByPage)
    for (const key of new Set(lines.map(termKey)))
      seenOnPages.set(key, (seenOnPages.get(key) || 0) + 1);
  const repeated = (line) => {
    const count = seenOnPages.get(termKey(line)) || 0;
    return count >= 3 && count >= linesByPage.length * 0.2;
  };

  const used = new Set();
  const snippets = [];
  let privateDropped = 0;
  const take = (page, line) => {
    const key = termKey(line);
    if (!key || used.has(key)) return false;
    if (containsPrivateInfo(line)) {
      privateDropped += 1;
      return false;
    }
    used.add(key);
    snippets.push({ page, text: line });
    return true;
  };

  for (const { page, section, lines } of linesByPage) {
    const usable = lines.filter((line) => !repeated(line));
    if (section && section.length <= MAX_LINE_CHARS) take(page, section);
    let titles = 0;
    for (const line of usable) {
      if (titles >= TITLE_LINES_PER_PAGE) break;
      if (!HANGUL.test(line) && !LATIN.test(line)) continue;
      if (take(page, line)) titles += 1;
    }
    let terms = 0;
    for (const line of usable) {
      if (terms >= TERM_LINES_PER_PAGE) break;
      if (!LATIN.test(line)) continue;
      if (take(page, line)) terms += 1;
    }
  }

  // A filename can contain personal information, even when page lines do not.
  const header = "문서: 등록 문서";
  const batches = [];
  let current = null;
  let omitted = 0;
  for (const snippet of snippets) {
    const line = `p.${snippet.page ?? "?"}: ${snippet.text}`;
    if (!current || current.chars + line.length + 1 > BATCH_CHARS) {
      if (batches.length >= MAX_BATCHES) {
        omitted += 1;
        continue;
      }
      current = { lines: [header], pages: new Set(), chars: header.length };
      batches.push(current);
    }
    current.lines.push(line);
    if (snippet.page) current.pages.add(snippet.page);
    current.chars += line.length + 1;
  }
  return {
    batches: batches.map((batch) => ({
      text: batch.lines.join("\n"),
      pages: [...batch.pages],
    })),
    lineCount: snippets.length,
    omitted,
    privateDropped,
  };
}

// ---- Gemini output checks ----------------------------------------------------

/**
 * Keeps only safe candidates: every word must be written in the lines that
 * were sent, no personal-looking words, 2~6 distinct words, no
 * insertion/removal mix, confidence at least 0.5.
 */
function validateCandidates(output, batch = { text: "", pages: [] }) {
  const haystack = termKey(batch.text);
  const sentPages = new Set(batch.pages || []);
  const result = [];
  const usedKeys = new Set();
  for (const item of Array.isArray(output?.groups) ? output.groups : []) {
    const terms = [];
    const keys = new Set();
    for (const raw of Array.isArray(item?.terms) ? item.terms : []) {
      const term = cleanTerm(raw);
      const key = termKey(term);
      if (term.length < 2 || term.length > 40 || keys.has(key)) continue;
      if (/^[\d\s.,:/-]+$/.test(term)) continue;
      if (!haystack.includes(key) || containsPrivateInfo(term)) continue;
      keys.add(key);
      terms.push(term);
    }
    if (terms.length < 2) continue;
    if ([...keys].some((key) => usedKeys.has(key))) continue;
    const confidence = Number(item?.confidence);
    if (!Number.isFinite(confidence) || confidence < MIN_CONFIDENCE) continue;
    let checked;
    try {
      checked = validateSynonymGroup({
        terms: terms.slice(0, MAX_TERMS),
        kind: item?.category === "약물" ? "drug" : "procedure",
        status: "needs_review",
      });
    } catch {
      continue;
    }
    for (const key of keys) usedKeys.add(key);
    const reason = cleanTerm(item?.reason).slice(0, 80);
    result.push({
      terms: checked.terms,
      kind: checked.kind,
      category: item?.category === "약물" ? "약물" : "용어",
      confidence: Math.min(1, Math.round(confidence * 100) / 100),
      reason: containsPrivateInfo(reason) ? "" : reason,
      pages: [
        ...new Set(
          (Array.isArray(item?.pages) ? item.pages : [])
            .map(Number)
            .filter((page) => sentPages.has(page))
        ),
      ]
        .sort((a, b) => a - b)
        .slice(0, 10),
    });
  }
  return result;
}

/** Candidates from several batches of one document; overlaps are merged. */
function mergeCandidates(candidates = []) {
  const merged = [];
  for (const candidate of candidates) {
    const keys = new Set(candidate.terms.map(termKey));
    const target = merged.find((item) =>
      item.terms.some((term) => keys.has(termKey(term)))
    );
    if (!target) {
      merged.push({ ...candidate, terms: [...candidate.terms] });
      continue;
    }
    const union = [...target.terms];
    for (const term of candidate.terms)
      if (!union.some((other) => termKey(other) === termKey(term)))
        union.push(term);
    if (union.length > MAX_TERMS) continue;
    try {
      validateSynonymGroup({ terms: union });
    } catch {
      continue;
    }
    target.terms = union;
    target.confidence = Math.min(target.confidence, candidate.confidence);
    target.pages = [...new Set([...target.pages, ...candidate.pages])].sort(
      (a, b) => a - b
    );
  }
  return merged;
}

// ---- comparison with the current synonym data --------------------------------

function parseJson(value, fallback) {
  try {
    const parsed = JSON.parse(value);
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

function addSource(sources = [], source) {
  const list = sources.map((item) => ({
    ...item,
    pages: [...(item.pages || [])],
  }));
  const found = list.find((item) =>
    item.documentId === source.documentId && item.type === source.type &&
    (source.type !== "staff_questions" || termKey(item.expression) === termKey(source.expression))
  );
  if (!found) {
    list.push({ ...source, pages: [...(source.pages || [])] });
    return { sources: list, changed: true };
  }
  const pages = [...new Set([...found.pages, ...(source.pages || [])])].sort(
    (a, b) => a - b
  );
  let changed = pages.length !== found.pages.length;
  found.pages = pages;
  if (source.type === "staff_questions") {
    changed ||= found.count !== source.count || found.example !== source.example;
    found.count = source.count;
    found.example = source.example;
  }
  return { sources: list, changed };
}

/**
 * Decides what to store for each candidate, without writing anything.
 *  - same words as an existing group (any status) → nothing new
 *  - shares words with exactly one group → only the new words, as an
 *    "addition" waiting for approval (the group itself is not changed)
 *  - shares words with several groups → nothing (too unclear)
 *  - words an administrator already deleted or dismissed → nothing
 *  - otherwise → a new "검토 필요" group
 * When the same candidate comes again from another document (for example a
 * new edition), that document is only added to the suggestion's sources.
 */
function planSuggestions(
  candidates = [],
  { groups = [], suggestions = [], source }
) {
  const groupKeys = groups.map((group) => ({
    group,
    keys: new Set((group.terms || []).map(termKey)),
  }));
  const plan = {
    newGroups: [],
    additions: [],
    sourceUpdates: new Map(),
    duplicates: 0,
    unclear: 0,
    dismissed: 0,
  };
  const touchSource = (row, pages) => {
    const current =
      plan.sourceUpdates.get(row.id)?.sources || row.sources || [];
    const { sources, changed } = addSource(current, { ...source, pages });
    if (changed) plan.sourceUpdates.set(row.id, { sources });
  };
  const closedKeys = new Set();
  for (const row of suggestions)
    if (row.status === "dismissed")
      for (const term of row.terms || []) closedKeys.add(termKey(term));

  for (const candidate of candidates) {
    const keys = candidate.terms.map(termKey);
    const overlapping = groupKeys.filter(({ keys: own }) =>
      keys.some((key) => own.has(key))
    );
    if (overlapping.length > 1) {
      plan.unclear += 1;
      continue;
    }
    if (overlapping.length === 1) {
      const { group, keys: own } = overlapping[0];
      const additionRows = suggestions.filter(
        (row) => row.type === "addition" && row.group_id === group.id
      );
      const groupRow = suggestions.find(
        (row) => row.type === "group" && row.group_id === group.id
      );
      const plannedForGroup = plan.additions.filter(
        (item) => item.groupId === group.id
      );
      const known = new Set([
        ...own,
        ...additionRows.flatMap((row) => row.terms.map(termKey)),
        ...plannedForGroup.flatMap((item) => item.terms.map(termKey)),
      ]);
      const inOtherGroups = new Set(
        groupKeys
          .filter((item) => item.group.id !== group.id)
          .flatMap((item) => [...item.keys])
      );
      const fresh = candidate.terms.filter((term) => {
        const key = termKey(term);
        return !known.has(key) && !inOtherGroups.has(key);
      });
      if (!fresh.length) {
        plan.duplicates += 1;
        // 추가 후보의 질문 증거로 기본 묶음의 다른 표현을 덮어쓰지 않는다.
        if (groupRow && (source.type !== "staff_questions" || keys.every(key => own.has(key))))
          touchSource(groupRow, candidate.pages);
        for (const row of additionRows)
          if (
            row.status === "pending" &&
            row.terms.some((term) => keys.includes(termKey(term)))
          )
            touchSource(row, candidate.pages);
        continue;
      }
      try {
        validateSynonymGroup({ terms: [...group.terms, ...fresh] });
      } catch {
        plan.unclear += 1;
        continue;
      }
      plan.additions.push({ ...candidate, groupId: group.id, terms: fresh });
      continue;
    }
    if (keys.every((key) => closedKeys.has(key))) {
      plan.dismissed += 1;
      continue;
    }
    plan.newGroups.push(candidate);
    // Later candidates of the same run compare against this one as well.
    groupKeys.push({
      group: { id: `new-${plan.newGroups.length}`, terms: candidate.terms },
      keys: new Set(keys),
    });
  }
  return plan;
}

// ---- storage ----------------------------------------------------------------

function prismaClient() {
  return require("../prisma");
}

function toSuggestionRow(row = {}) {
  return {
    ...row,
    terms: parseJson(row.terms, []),
    sources: parseJson(row.sources, []),
  };
}

// A verification run only adds rows tagged with its run id, so they can be
// removed exactly; it never adds sources to rows that existed before.
async function storePlan(
  plan,
  { prisma, method, source, runId = null, test = false }
) {
  const now = new Date();
  for (const candidate of plan.newGroups) {
    const group = await prisma.schat_synonym_groups.create({
      data: {
        terms: JSON.stringify(candidate.terms),
        kind: candidate.kind,
        status: "needs_review",
        source: "auto",
        note: null,
      },
    });
    await prisma.schat_synonym_suggestions.create({
      data: {
        type: "group",
        group_id: group.id,
        terms: JSON.stringify(candidate.terms),
        category: candidate.category,
        confidence: candidate.confidence,
        reason: candidate.reason || null,
        method,
        sources: JSON.stringify([{ ...source, pages: candidate.pages }]),
        status: "pending",
        run_id: runId,
      },
    });
  }
  for (const addition of plan.additions)
    await prisma.schat_synonym_suggestions.create({
      data: {
        type: "addition",
        group_id: addition.groupId,
        terms: JSON.stringify(addition.terms),
        category: addition.category,
        confidence: addition.confidence,
        reason: addition.reason || null,
        method,
        sources: JSON.stringify([{ ...source, pages: addition.pages }]),
        status: "pending",
        run_id: runId,
      },
    });
  if (test) return;
  for (const [id, { sources }] of plan.sourceUpdates)
    await prisma.schat_synonym_suggestions.update({
      where: { id },
      data: { sources: JSON.stringify(sources), lastUpdatedAt: now },
    });
}

// ---- running after a document upload -------------------------------------------

function defaultLlm() {
  const { GeminiLLM } = require("../AiProviders/gemini");
  return new GeminiLLM(null, process.env.GEMINI_LLM_MODEL_PREF || null);
}

async function defaultLoadDocument(document = {}) {
  if (typeof document.pageContent === "string") return document;
  const { fileData } = require("../files");
  return fileData(document.location);
}

async function defaultLogEvent(event, metadata) {
  const { EventLogs } = require("../../models/eventLogs");
  return EventLogs.logEvent(event, metadata);
}

function errorCode(error) {
  const message = String(error?.message || "");
  if (error?.code) return String(error.code).slice(0, 40);
  if (/api key/i.test(message)) return "no_api_key";
  if (
    /429|quota|rate.?limit|resource.?exhausted|too many requests/i.test(message)
  )
    return "rate_limited";
  if (/503|overloaded|unavailable/i.test(message)) return "unavailable";
  if (/401|403/i.test(message)) return "unauthorized";
  if (/timeout|timed out|abort/i.test(message)) return "timeout";
  return "failed";
}

// Rate limit (429) or a busy service (503): wait, then try again. At most
// three retries per request; then the document is marked failed.
const RETRY_DELAYS_MS = Object.freeze([15_000, 30_000, 60_000]);
const RETRYABLE = new Set(["rate_limited", "unavailable"]);
const MAX_RETRY_WAIT_MS = 120_000;

function retryAfterMs(error) {
  const match = String(error?.message || "").match(
    /retry[^0-9]{0,30}(\d+(?:\.\d+)?)\s*s/i
  );
  return match
    ? Math.min(MAX_RETRY_WAIT_MS, Math.ceil(Number(match[1]) * 1000))
    : 0;
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function askOnce(llm, batch) {
  const result = await llm.getChatCompletion(
    [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: batch.text },
    ],
    { temperature: 0, responseSchema: SUGGESTION_SCHEMA, maxRetries: 0 }
  );
  const text = result?.textResponse;
  if (!text) throw Object.assign(new Error("empty"), { code: "empty" });
  try {
    return JSON.parse(text);
  } catch {
    throw Object.assign(new Error("invalid_json"), { code: "invalid_json" });
  }
}

async function askGemini(
  llm,
  batch,
  {
    sleep = wait,
    delays = RETRY_DELAYS_MS,
    onRetry = () => null,
    beforeAttempt = async () => {},
  } = {}
) {
  for (let attempt = 0; ; attempt += 1) {
    await beforeAttempt(); // 내부 재시도 대기 중 바뀐 문서도 외부 호출 전에 확인한다.
    try {
      return await askOnce(llm, batch);
    } catch (error) {
      const code = errorCode(error);
      if (!RETRYABLE.has(code) || attempt >= delays.length) throw error;
      onRetry(code);
      await sleep(Math.max(delays[attempt], retryAfterMs(error)));
    }
  }
}

function enabled() {
  return !/^(off|false|0)$/i.test(
    String(process.env.SCHAT_SYNONYM_SUGGESTIONS || "")
  );
}

/** Reads the uploaded pages and groups them by document. Never throws. */
async function loadDocuments(
  documents = [],
  loadDocument = defaultLoadDocument
) {
  const byDocument = new Map();
  for (const document of Array.isArray(documents) ? documents : []) {
    try {
      const data = await loadDocument(document);
      if (!data?.document_id || typeof data.pageContent !== "string") continue;
      const entry = byDocument.get(data.document_id) || {
        documentId: data.document_id,
        documentName: cleanTerm(data.title || ""),
        pages: [],
      };
      entry.pages.push({
        page: data.page,
        section: data.section,
        pageContent: data.pageContent,
      });
      byDocument.set(data.document_id, entry);
    } catch {
      // A page that cannot be read is simply left out.
    }
  }
  return [...byDocument.values()];
}

// Too little text (mostly pictures or scans): no Gemini call, shown as
// "텍스트 부족" instead of forcing candidates.
const MIN_CHARS_PER_PAGE = 50;
const MIN_LINES = 3;

function textIsShort({ chars, pages, lineCount }) {
  return (
    chars / Math.max(1, pages) < MIN_CHARS_PER_PAGE || lineCount < MIN_LINES
  );
}

const DOCUMENT_STATUS = Object.freeze({
  pending: "처리 대기",
  running: "처리 중",
  created: "후보 생성",
  no_new: "새 후보 없음",
  text_short: "텍스트 부족",
  failed: "실패",
  stopped: "중단(호출 한도)",
});

function emptyRow(document) {
  return {
    retryVersion: 1,
    documentId: String(document.documentId),
    documentDigest: documentDigest(document),
    batches: collectSnippets(document.pages).batches.map((batch, index) => ({
      index,
      pages: batch.pages,
      status: "pending",
      candidates: [],
      error: null,
    })),
    documentName: document.documentName,
    pages: document.pages.length,
    chars: document.pages.reduce(
      (sum, page) => sum + page.pageContent.length,
      0
    ),
    status: "pending",
    candidates: 0,
    newGroups: 0,
    additions: 0,
    duplicates: 0,
    excluded: 0,
    geminiCalls: 0,
    retries: 0,
    linesNotSent: 0,
    privateLinesExcluded: 0,
    error: null,
  };
}

function documentDigest(document) {
  return createHash("sha256")
    .update(
      JSON.stringify({
        id: String(document.documentId),
        name: document.documentName,
        pages: [...document.pages]
          .map((page) => ({
            page: page.page,
            section: page.section || "",
            text: page.pageContent,
          }))
          .sort((a, b) => Number(a.page) - Number(b.page)),
      })
    )
    .digest("hex");
}

function storageError() {
  return Object.assign(
    new Error(
      "실행 기록을 저장하지 못해 안전하게 중단했어요. 관리자에게 확인해 주세요."
    ),
    { code: "persistence_failed" }
  );
}

async function saveProgress(prisma, runId, rows, extra = {}) {
  if (!runId) return;
  try {
    await prisma.schat_synonym_suggestion_runs.update({
      where: { id: runId },
      data: {
        documents: JSON.stringify(rows),
        summary: JSON.stringify(summarize(rows)),
        ...extra,
      },
    });
  } catch {
    throw storageError();
  }
}

async function processDocument(
  document,
  {
    llm,
    prisma,
    logEvent,
    logger,
    sleep,
    delays,
    runId,
    test,
    dryRun,
    row = emptyRow(document),
    checkpoint = async () => {},
    batchIndices = null,
    validateCurrent = async () => {},
  }
) {
  const source = {
    documentId: document.documentId,
    documentName: document.documentName,
  };
  row.error = null;
  try {
    const snippets = collectSnippets(document.pages, document);
    row.linesNotSent = snippets.omitted;
    row.privateLinesExcluded = snippets.privateDropped;
    if (
      !snippets.batches.length ||
      textIsShort({
        chars: row.chars,
        pages: row.pages,
        lineCount: snippets.lineCount,
      })
    ) {
      row.status = "text_short";
      return row;
    }
    const client = llm || defaultLlm();
    row.status = "running";
    const method = `${METHOD}:${client.model || "gemini"}`;
    for (const [index, batch] of snippets.batches.entries()) {
      const saved = row.batches[index];
      if (
        saved.status === "succeeded" ||
        (batchIndices && !batchIndices.includes(index))
      )
        continue;
      await validateCurrent();
      saved.status = "running";
      saved.error = null;
      await checkpoint(); // 외부 호출 전에 기록을 남겨 불확실한 중복 호출을 막는다.
      row.geminiCalls += 1;
      try {
        const output = await askGemini(client, batch, {
          sleep,
          delays,
          beforeAttempt: validateCurrent,
          onRetry: () => {
            row.retries += 1;
          },
        });
        saved.candidates = validateCandidates(output, batch);
        saved.status = "succeeded";
      } catch (error) {
        saved.status = "failed";
        saved.error = errorCode(error);
        row.error = saved.error;
      }
      await checkpoint(); // 성공 결과를 다음 묶음 호출보다 먼저 보존한다.
      if (saved.status === "failed") break;
    }
    await validateCurrent(); // 응답 대기 중 변경·삭제된 문서의 후보는 반영하지 않는다.
    const candidates = row.batches
      .filter((batch) => batch.status === "succeeded")
      .flatMap((batch) => batch.candidates);
    const merged = mergeCandidates(candidates);
    row.candidates = merged.length;
    const unapplied = row.batches.filter(
      (batch) => batch.status === "succeeded" && !batch.applied
    );
    // AI 대기가 끝난 뒤 최신 자료 조회부터 저장까지만 관리자 변경과 묶는다.
    const plan = await serialized(() =>
      prisma.$transaction(async (tx) => {
        const groups = (
          await tx.schat_synonym_groups.findMany({ orderBy: [{ id: "asc" }] })
        ).map((item) => ({
          id: item.id,
          terms: parseJson(item.terms, []),
          status: item.status,
        }));
        const suggestions = (await tx.schat_synonym_suggestions.findMany()).map(
          toSuggestionRow
        );
        const plan = planSuggestions(
          mergeCandidates(unapplied.flatMap((batch) => batch.candidates)),
          { groups, suggestions, source }
        );
        if (!dryRun) {
          await storePlan(plan, { prisma: tx, method, source, runId, test });
        }
        row.newGroups += plan.newGroups.length;
        row.additions += plan.additions.length;
        row.duplicates += plan.duplicates;
        row.excluded += plan.unclear + plan.dismissed;
        for (const batch of unapplied) batch.applied = true;
        const incomplete = row.batches.find(
          (batch) => batch.status !== "succeeded"
        );
        row.status = incomplete
          ? "failed"
          : row.newGroups + row.additions > 0
            ? "created"
            : "no_new";
        row.error = incomplete?.error || (incomplete ? "pending" : null);
        await checkpoint(tx); // 후보 반영과 완료 기록을 같은 저장 작업으로 묶는다.
        return plan;
      })
    ).catch(() => {
      throw storageError();
    });
    if (dryRun)
      row.preview = {
        newGroups: plan.newGroups.map((item) => item.terms),
        additions: plan.additions.map((item) => ({
          groupId: item.groupId,
          terms: item.terms,
        })),
      };
    else
      await logEvent(
        row.status === "failed"
          ? "schat_synonym_suggestion_failed"
          : "schat_synonym_suggestions_created",
        {
          ...(row.status === "failed"
            ? { message: "동의어 후보 자동 생성 실패", reason: row.error }
            : {}),
          documentName: document.documentName,
          newGroups: row.newGroups,
          additions: row.additions,
          duplicates: row.duplicates,
          geminiCalls: row.geminiCalls,
          retries: row.retries,
          privateLinesExcluded: row.privateLinesExcluded,
          linesNotSent: row.linesNotSent,
        }
      ).catch(() => null);
  } catch (error) {
    if (error?.code === "persistence_failed") throw error;
    row.status = "failed";
    row.error = errorCode(error);
    logger?.error?.(
      `[SchatSynonymSuggestions] 동의어 후보 자동 생성 실패: ${row.error}`
    );
    if (!dryRun)
      await logEvent("schat_synonym_suggestion_failed", {
        message: "동의어 후보 자동 생성 실패",
        documentName: document.documentName,
        reason: row.error,
        retries: row.retries,
      }).catch(() => null);
  }
  return row;
}

function summarize(rows = []) {
  const count = (status) => rows.filter((row) => row.status === status).length;
  const sum = (key) => rows.reduce((total, row) => total + (row[key] || 0), 0);
  return {
    documents: rows.length,
    succeeded: count("created") + count("no_new"),
    failed: count("failed"),
    textShort: count("text_short"),
    stopped: count("stopped"),
    candidates: sum("candidates"),
    newGroups: sum("newGroups"),
    additions: sum("additions"),
    duplicates: sum("duplicates"),
    excluded: sum("excluded"),
    geminiCalls: sum("geminiCalls"),
    retries: sum("retries"),
  };
}

async function startRun(prisma, { trigger, test }) {
  try {
    const run = await prisma.schat_synonym_suggestion_runs.create({
      data: { trigger, test: Boolean(test), status: "running" },
    });
    return run.id;
  } catch {
    throw storageError();
  }
}

async function finishRun(prisma, runId, rows, summary) {
  await saveProgress(prisma, runId, rows, {
    status: "done",
    summary: JSON.stringify(summary),
    finishedAt: new Date(),
  });
}

async function notifyFailures(prisma, rows) {
  const count = rows.filter((row) =>
    ["failed", "stopped"].includes(row.status)
  ).length;
  if (!count) return;
  const admins = await prisma.users.findMany({
    where: { role: "admin", suspended: 0 },
    select: { id: true },
  });
  for (const admin of admins)
    await prisma.schat_user_notifications.create({
      data: {
        user_id: admin.id,
        kind: "synonym_generation_failed",
        message: `동의어 자동 생성에서 ${count}개 문서가 완료되지 않았어요. 관리자 화면의 동의어 관리에서 실패한 부분을 확인해 주세요.`,
      },
    });
}

/**
 * Creates "검토 필요" suggestions for already loaded documents, one document
 * at a time. AI failures are listed; persistence failures stop the run.
 * trigger: upload | document_update | backfill. test: a verification run
 * whose rows can be removed later. dryRun: nothing is stored at all.
 */
async function suggestForDocuments(
  loaded = [],
  {
    llm = null,
    prisma = prismaClient(),
    logEvent = defaultLogEvent,
    logger = console,
    sleep = wait,
    delays = RETRY_DELAYS_MS,
    trigger = "upload",
    test = false,
    dryRun = false,
    onDocument = null,
  } = {}
) {
  const startedAt = Date.now();
  let runId = null;
  const rows = loaded.map(emptyRow);
  try {
    runId = dryRun ? null : await startRun(prisma, { trigger, test });
    const checkpoint = (client = prisma) =>
      dryRun ? Promise.resolve() : saveProgress(client, runId, rows);
    await checkpoint();
    let stopped = false;
    for (const [index, document] of loaded.entries()) {
      if (stopped) {
        rows[index].status = "stopped";
        await checkpoint();
        continue;
      }
      const row = await serializeGeneration(() =>
        processDocument(document, {
          llm,
          prisma,
          logEvent,
          logger,
          sleep,
          delays,
          runId,
          test,
          dryRun,
          row: rows[index],
          checkpoint,
        })
      );
      onDocument?.(row);
      // The quota is used up: the rest would fail the same way. Running again
      // later is safe because duplicates are never created.
      if (row.status === "failed" && row.error === "rate_limited")
        stopped = true;
    }
    const summary = {
      ...summarize(rows),
      seconds: Math.round((Date.now() - startedAt) / 1000),
    };
    if (!dryRun) {
      await finishRun(prisma, runId, rows, summary);
      await notifyFailures(prisma, rows).catch(() =>
        logger?.error?.("[SchatSynonymSuggestions] 관리자 실패 알림 저장 실패")
      );
    }
    return {
      runId,
      trigger,
      test,
      dryRun,
      ...summary,
      failedDocuments: rows
        .filter((row) => row.status === "failed")
        .map((row) => ({ documentName: row.documentName, code: row.error })),
      rows,
    };
  } catch (error) {
    if (!dryRun) {
      if (runId)
        await prisma.schat_synonym_suggestion_runs
          .update({
            where: { id: runId },
            data: { status: "persistence_failed" },
          })
          .catch(() => null);
      await notifyFailures(prisma, [{ status: "failed" }]).catch(() => null);
    }
    throw error;
  }
}

/**
 * Called right after a document is registered. Reads the new pages now (they
 * may be moved to a folder next) and asks Gemini in the background, so the
 * upload answer is not delayed. Never throws.
 */
async function scheduleSynonymSuggestions(documents = [], options = {}) {
  try {
    if (!enabled()) return null;
    const loaded = await loadDocuments(documents, options.loadDocument);
    if (!loaded.length) return null;
    const run = new Promise((resolve) => setImmediate(resolve)).then(() =>
      suggestForDocuments(loaded, options)
    );
    run.catch(() => null);
    // Returning the promise directly from an async function would make callers
    // awaiting this upload hook wait for every provider call and retry.
    return { scheduled: true, completion: run };
  } catch {
    return null;
  }
}

/** Every registered page (each file once), for the one-time run. */
async function registeredDocuments(prisma = prismaClient()) {
  const rows = await prisma.workspace_documents.findMany({
    select: { docpath: true },
  });
  return [...new Set(rows.map((row) => row.docpath))].map((location) => ({
    location,
  }));
}

async function retryRun(runId, options = {}) {
  const id = Number(runId);
  if (!Number.isSafeInteger(id) || id <= 0)
    throw new Error("실행 기록을 확인해 주세요.");
  if (activeRetries.has(id))
    throw new Error("이미 다시 시도하고 있어요. 완료될 때까지 기다려 주세요.");
  activeRetries.add(id);
  const {
    prisma = prismaClient(),
    llm = null,
    logEvent = defaultLogEvent,
    logger = console,
    sleep = wait,
    delays = RETRY_DELAYS_MS,
    targets = null,
    loadCurrentDocuments = async () =>
      loadDocuments(await registeredDocuments(prisma)),
  } = options;
  let claimed = false;
  let rows;
  try {
    const run = await prisma.schat_synonym_suggestion_runs.findUnique({
      where: { id },
    });
    if (!run) throw new Error("실행 기록을 찾지 못했어요.");
    if (run.status !== "done")
      throw new Error(
        "진행 중이거나 저장을 확인해야 하는 실행은 다시 시도할 수 없어요."
      );
    rows = parseJson(run.documents, []);
    if (
      !rows.length ||
      rows.some(
        (row) =>
          row.retryVersion !== 1 ||
          !row.documentId ||
          !row.documentDigest ||
          !Array.isArray(row.batches)
      )
    )
      throw new Error(
        "과거 기록에는 실패한 범위가 없어 다시 시도할 수 없어요. 새 실행부터 지원해요."
      );
    if (
      targets !== null &&
      (!Array.isArray(targets) ||
        !targets.length ||
        targets.length > rows.length)
    )
      throw new Error("실패한 범위를 선택해 주세요.");
    const requested =
      targets ??
      rows
        .filter((row) => ["failed", "stopped"].includes(row.status))
        .map((row) => ({
          documentId: row.documentId,
          batchIndices: row.batches
            .filter((batch) => ["failed", "pending"].includes(batch.status))
            .map((batch) => batch.index),
        }));
    if (!requested.length) throw new Error("다시 시도할 실패 범위가 없어요.");
    const current = await loadCurrentDocuments();
    const seen = new Set();
    const work = requested.map((target) => {
      const row = rows.find((row) => row.documentId === target.documentId);
      if (
        !row ||
        seen.has(row.documentId) ||
        !["failed", "stopped"].includes(row.status)
      )
        throw new Error("실패한 문서만 한 번씩 선택해 주세요.");
      seen.add(row.documentId);
      if (
        !Array.isArray(target.batchIndices) ||
        !target.batchIndices.length ||
        new Set(target.batchIndices).size !== target.batchIndices.length ||
        target.batchIndices.some(
          (index) =>
            !Number.isInteger(index) ||
            !row.batches.some(
              (batch) =>
                batch.index === index &&
                ["failed", "pending"].includes(batch.status)
            )
        )
      )
        throw new Error(
          "실패한 범위만 선택해 주세요. 성공한 범위는 다시 호출하지 않아요."
        );
      const document = current.find(
        (doc) => String(doc.documentId) === row.documentId
      );
      if (!document)
        throw new Error(
          "문서가 삭제되었거나 읽을 수 없어 다시 시도할 수 없어요."
        );
      if (documentDigest(document) !== row.documentDigest)
        throw new Error(
          "문서 내용이 변경되어 다시 시도할 수 없어요. 새 실행이 필요해요."
        );
      const batches = collectSnippets(document.pages).batches;
      if (
        batches.length !== row.batches.length ||
        row.batches.some(
          (batch, index) =>
            batch.index !== index ||
            JSON.stringify(batch.pages) !== JSON.stringify(batches[index].pages)
        )
      )
        throw new Error("문서 처리 범위가 변경되어 다시 시도할 수 없어요.");
      return {
        row,
        document,
        batchIndices: target.batchIndices,
        validateCurrent: async () => {
          const live = (await loadCurrentDocuments()).find(
            (doc) => String(doc.documentId) === row.documentId
          );
          if (!live || documentDigest(live) !== row.documentDigest)
            throw Object.assign(
              new Error("문서가 변경되거나 삭제되어 재시도를 중단했어요."),
              { code: "document_changed" }
            );
        },
      };
    });
    try {
      const claim = await prisma.schat_synonym_suggestion_runs.updateMany({
        where: { id, status: "done" },
        data: { status: "retrying", finishedAt: null },
      });
      if (claim.count !== 1) throw new Error("이미 다시 시도하고 있어요.");
      claimed = true;
    } catch (error) {
      if (/이미/.test(error.message)) throw error;
      throw storageError();
    }
    const checkpoint = (client = prisma) => saveProgress(client, id, rows);
    for (const item of work) {
      const row = await serializeGeneration(() =>
        processDocument(item.document, {
          ...item,
          llm,
          prisma,
          logEvent,
          logger,
          sleep,
          delays,
          runId: id,
          test: Boolean(run.test),
          dryRun: false,
          checkpoint,
        })
      );
      if (row.error === "rate_limited") break;
    }
    const summary = summarize(rows);
    await finishRun(prisma, id, rows, summary);
    await notifyFailures(prisma, rows).catch(() =>
      logger?.error?.("[SchatSynonymSuggestions] 관리자 실패 알림 저장 실패")
    );
    return { runId: id, ...summary, rows };
  } catch (error) {
    if (claimed) {
      // 저장 불확실 상태는 재호출 금지. 복구 전에는 완료로 표시하지 않는다.
      await prisma.schat_synonym_suggestion_runs
        .update({ where: { id }, data: { status: "persistence_failed" } })
        .catch(() => null);
      await notifyFailures(prisma, [{ status: "failed" }]).catch(() =>
        logger?.error?.("[SchatSynonymSuggestions] 관리자 실패 알림 저장 실패")
      );
    }
    throw error;
  } finally {
    activeRetries.delete(id);
  }
}

/**
 * Removes everything one verification run created: its 검토 필요 groups and
 * suggestion rows. Rows that existed before the run are never touched, and a
 * run that was not marked as verification is refused.
 */
async function removeTestRun(runId, prisma = prismaClient()) {
  return prisma.$transaction(async (prisma) => {
    const run = await prisma.schat_synonym_suggestion_runs.findUnique({
      where: { id: Number(runId) },
    });
    if (!run) throw new Error("실행 기록을 찾지 못했습니다.");
    if (!run.test) throw new Error("검증용 실행만 지울 수 있습니다.");
    const rows = await prisma.schat_synonym_suggestions.findMany({
      where: { run_id: run.id },
    });
    let groups = 0;
    if (rows.some((row) => row.status === "approved"))
      throw new Error("승인한 후보가 있어 검증 결과를 자동 삭제하지 않습니다.");
    for (const row of rows) {
      if (row.type !== "group" || !row.group_id) continue;
      const group = await prisma.schat_synonym_groups.findUnique({
        where: { id: row.group_id },
      });
      if (!group || group.source !== "auto") continue;
      if (group.status !== "needs_review" || group.terms !== row.terms)
        throw new Error(
          "승인하거나 수정한 묶음이 있어 검증 결과를 자동 삭제하지 않습니다."
        );
      await prisma.schat_synonym_groups.delete({ where: { id: group.id } });
      groups += 1;
    }
    const removed = await prisma.schat_synonym_suggestions.deleteMany({
      where: { run_id: run.id },
    });
    await prisma.schat_synonym_suggestion_runs.update({
      where: { id: run.id },
      data: { status: "removed" },
    });
    return { groups, suggestions: removed.count };
  });
}

async function listRuns(prisma = prismaClient(), limit = 10) {
  try {
    const rows = await prisma.schat_synonym_suggestion_runs.findMany({
      orderBy: [{ id: "desc" }],
      take: limit,
    });
    return rows.map((row) => ({
      id: row.id,
      trigger: row.trigger,
      test: Boolean(row.test),
      status: row.status,
      summary: parseJson(row.summary, {}),
      documents: parseJson(row.documents, []).map((item) => ({
        ...item,
        batches: item.batches?.map(({ candidates, ...batch }) => ({
          ...batch,
          retryable:
            row.status === "done" &&
            item.retryVersion === 1 &&
            ["failed", "pending"].includes(batch.status),
        })),
        retryable:
          row.status === "done" &&
          item.retryVersion === 1 &&
          ["failed", "stopped"].includes(item.status) &&
          item.batches?.some((batch) =>
            ["failed", "pending"].includes(batch.status)
          ),
        statusText: DOCUMENT_STATUS[item.status] || item.status,
      })),
      startedAt: row.startedAt,
      finishedAt: row.finishedAt,
    }));
  } catch {
    return [];
  }
}

// ---- administrator screen ---------------------------------------------------------

async function liveDocumentIds(prisma, originalMetadata) {
  const rows = await prisma.workspace_documents.findMany({
    select: { metadata: true, workspace: { select: { slug: true } } },
  });
  const ids = new Map();
  for (const row of rows) {
    const metadata = parseJson(row.metadata, {});
    const id = metadata?.document_id;
    if (!id) continue;
    let reference = {};
    try {
      if (row.workspace?.slug) {
        const original = originalMetadata(metadata);
        if (
          original.originalPdfAvailable &&
          /^[A-Za-z0-9_-]{43}$/.test(original.pdfRef || "")
        )
          reference = {
            workspaceSlug: row.workspace.slug,
            pdfRef: original.pdfRef,
            originalPdfAvailable: true,
          };
      }
    } catch {
      /* 원문이 없거나 지원하지 않는 문서는 근거 이름만 남긴다. */
    }
    if (!ids.has(String(id)) || reference.pdfRef)
      ids.set(String(id), reference);
  }
  return ids;
}

function publicSuggestion(row, liveIds, testRuns = new Set()) {
  const sources = (row.sources || []).map((source) => ({
    ...(source.type === "staff_questions" ? {
      type: "staff_questions",
      count: Number.isSafeInteger(source.count) && source.count >= 2 ? source.count : 0,
      example: require("./questionCandidates").safeExample(source.example),
    } : {}),
    documentName: source.documentName || "",
    pages: source.pages || [],
    missing: !liveIds.has(String(source.documentId)),
    ...(liveIds.get(String(source.documentId)) || {}),
  }));
  return {
    id: row.id,
    type: row.type,
    terms: row.terms,
    category: row.category || "",
    confidence: row.confidence,
    lowConfidence: Number(row.confidence) < LOW_CONFIDENCE,
    reason: row.reason || "",
    method: row.method,
    status: row.status,
    createdAt: row.createdAt,
    // Made by a verification run: shown as 검증용 and removable as a whole.
    test: row.run_id != null && testRuns.has(row.run_id),
    runId: row.run_id ?? null,
    sources,
    // Every source document was deleted: kept for review, never removed automatically.
    sourceMissing:
      sources.length > 0 && sources.every((source) => source.missing),
  };
}

/**
 * Adds review information to the admin list: where an automatic group came
 * from, and the words waiting to be added to an existing group.
 */
async function withSuggestions(
  groups = [],
  prisma = prismaClient(),
  {
    originalMetadata = (metadata) =>
      require("../originalDocuments").publicOriginalPdfMetadata(metadata),
  } = {}
) {
  let rows = [];
  try {
    rows = (
      await prisma.schat_synonym_suggestions.findMany({
        orderBy: [{ id: "asc" }],
      })
    ).map(toSuggestionRow);
  } catch {
    return groups;
  }
  if (!rows.length) return groups;
  const liveIds = await liveDocumentIds(prisma, originalMetadata).catch(
    () => new Map()
  );
  const testRuns = new Set(
    (
      await prisma.schat_synonym_suggestion_runs
        ?.findMany({ where: { test: true } })
        .catch(() => [])
    )?.map((run) => run.id) || []
  );
  return groups.map((group) => {
    const own = rows.find(
      (row) => row.type === "group" && row.group_id === group.id
    );
    const additions = rows.filter(
      (row) =>
        row.type === "addition" &&
        row.group_id === group.id &&
        row.status === "pending"
    );
    return {
      ...group,
      suggestion: own ? publicSuggestion(own, liveIds, testRuns) : null,
      pendingAdditions: additions.map((row) =>
        publicSuggestion(row, liveIds, testRuns)
      ),
    };
  });
}

async function findPendingAddition(id, prisma) {
  const row = await prisma.schat_synonym_suggestions.findUnique({
    where: { id: Number(id) },
  });
  if (
    !row ||
    !["group", "addition"].includes(row.type) ||
    row.status !== "pending"
  )
    return null;
  return toSuggestionRow(row);
}

/** 기존 자동 후보를 승인한다. 승인할 때 새 묶음은 만들지 않는다. */
async function approveAddition(id, prisma = prismaClient()) {
  const saved = await serialized(() =>
    prisma.$transaction(async (tx) => {
      const row = await findPendingAddition(id, tx);
      if (!row) return null;
      const group = await tx.schat_synonym_groups.findUnique({
        where: { id: row.group_id },
      });
      if (!group)
        throw new Error("추가할 묶음이 없습니다. 후보를 거절해 주세요.");
      if (
        row.type === "group" &&
        (group.source !== "auto" || group.status !== "needs_review")
      )
        return null;
      const oldTerms = parseJson(group.terms, []);
      const terms = row.type === "group" ? oldTerms : [...oldTerms];
      if (row.type === "addition")
        for (const term of row.terms)
          if (!terms.some((value) => termKey(value) === termKey(term)))
            terms.push(term);
      const checked = await validateStoredGroup(
        {
          ...group,
          terms,
          status: row.type === "group" ? "active" : group.status,
        },
        tx,
        group
      );
      const saved = await tx.schat_synonym_groups.update({
        where: { id: group.id },
        data: {
          terms: JSON.stringify(checked.terms),
          status: checked.status,
          lastUpdatedAt: new Date(),
        },
      });
      await tx.schat_synonym_suggestions.update({
        where: { id: row.id },
        data: { status: "approved", lastUpdatedAt: new Date() },
      });
      return toPublicGroup(saved);
    })
  );
  if (saved) invalidate();
  return saved;
}

/** The administrator rejects the words; they are not suggested again. */
async function dismissAddition(id, prisma = prismaClient()) {
  const dismissed = await serialized(() =>
    prisma.$transaction(async (tx) => {
      const row = await findPendingAddition(id, tx);
      if (!row) return false;
      if (row.type === "group") {
        const group = await tx.schat_synonym_groups.findUnique({
          where: { id: row.group_id },
        });
        if (
          !group ||
          group.source !== "auto" ||
          group.status !== "needs_review"
        )
          return false;
        await tx.schat_synonym_groups.update({
          where: { id: group.id },
          data: { status: "off", lastUpdatedAt: new Date() },
        });
      }
      await tx.schat_synonym_suggestions.update({
        where: { id: row.id },
        data: { status: "dismissed", lastUpdatedAt: new Date() },
      });
      return true;
    })
  );
  if (dismissed) invalidate();
  return dismissed;
}

async function approveVisible(ids, prisma = prismaClient()) {
  if (
    !Array.isArray(ids) ||
    ids.length > 1000 ||
    ids.some((id) => !Number.isSafeInteger(id) || id <= 0)
  )
    throw new Error("넣을 제안을 다시 선택해 주세요.");
  const result = { approved: [], skipped: [], failed: [] };
  for (const id of new Set(ids)) {
    try {
      const saved = await approveAddition(id, prisma);
      result[saved ? "approved" : "skipped"].push(id);
    } catch (error) {
      result.failed.push({
        id,
        error: /[가-힣]/.test(error.message || "")
          ? error.message
          : "제안을 넣지 못했어요.",
      });
    }
  }
  return result;
}

/** A deleted group's suggestions are kept as "dismissed" so they do not return. */
async function closeSuggestionsOfGroup(groupId, prisma = prismaClient()) {
  try {
    await prisma.schat_synonym_suggestions.updateMany({
      where: { group_id: Number(groupId), status: "pending" },
      data: { status: "dismissed", lastUpdatedAt: new Date() },
    });
  } catch {
    // The suggestion table is optional for deleting a group.
  }
}

module.exports = {
  CATEGORIES,
  METHOD,
  SUGGESTION_SCHEMA,
  SYSTEM_PROMPT,
  containsPrivateInfo,
  collectSnippets,
  validateCandidates,
  mergeCandidates,
  planSuggestions,
  storePlan,
  loadDocuments,
  suggestForDocuments,
  retryRun,
  scheduleSynonymSuggestions,
  registeredDocuments,
  removeTestRun,
  listRuns,
  DOCUMENT_STATUS,
  RETRY_DELAYS_MS,
  withSuggestions,
  approveAddition,
  approveVisible,
  dismissAddition,
  closeSuggestionsOfGroup,
};
