/**
 * SCHAT keyword supplement for Chroma vector search.
 *
 * This module is intentionally dependency-free. Gemini/Chroma remains the
 * primary retriever; BM25 only adds a smaller rank contribution for exact
 * Korean clinical terms, English abbreviations, and numeric tokens.
 */

function tokenize(text = "") {
  if (typeof text !== "string") return [];
  return (
    text
      .normalize("NFKC")
      .toLowerCase()
      .match(/[가-힣]+|[a-z0-9]+(?:\.[0-9]+)?/giu) || []
  );
}

const QUERY_STOPWORDS = new Set([
  "알려줘",
  "알려주세요",
  "설명해줘",
  "설명해주세요",
  "뭐야",
  "무엇",
  "무엇인가요",
  "관련",
  "질문",
  "어떻게",
  "대해",
  "대해서",
  "대하여",
  "대한",
  "관해",
  "관하여",
]);
// Request / conversational words that say HOW to answer, not WHAT to find.
// They stay in the BM25 score but are left out of the word-coverage share
// (bm25Coverage) used by filterWeakHybridTail, so "혈액제제 종류를 사진으로
// 보여줘" is judged like "혈액제제 종류". Collected from staff questions
// (2026-09-28) plus the display/request forms asked for by the reviewer.
const COVERAGE_REQUEST_WORDS = new Set([
  // show / picture requests
  "사진",
  "그림",
  "이미지",
  "도식",
  "도표",
  "그래프",
  "영상",
  "보여줘",
  "보여주세요",
  "보여줄래",
  "보여줄",
  "보여",
  // tell / explain requests (and common typos)
  "알려줘",
  "알려주세요",
  "알려줄래",
  "알랴줘",
  "알렺줘",
  "가르쳐줘",
  "설명해주",
  "정리해줘",
  "요약해줘",
  "자세히",
  "간단히",
  "궁금해",
  "궁금해요",
  "궁금합니다",
  "부탁해",
  "부탁해요",
  // conversational endings seen in staff questions
  "어때",
  "의미야",
  "뭐예요",
  "뭔가요",
  "뭔지",
  "받아야해",
  "받아야할까",
  "받아야",
  "할까",
  "할까요",
  "해야해",
  "했는데",
  "했을",
  "됐는데",
  "되나요",
  "하나요",
  "있나요",
]);

const { termAlternatives } = require("../../synonyms");

function coverageTerms(terms = []) {
  const content = terms.filter((term) => !COVERAGE_REQUEST_WORDS.has(term));
  return content.length ? content : terms;
}

// Questions that explicitly ask for a picture. Only these questions use the
// image-request routes below; every other question keeps the old behaviour.
// ("영상" is left out: 영상검사 is an exam name, not a picture request.)
const IMAGE_REQUEST_PATTERN = /사진|그림|이미지|도식|도표|그래프/u;

function isImageRequest(queryText = "") {
  return (
    typeof queryText === "string" &&
    IMAGE_REQUEST_PATTERN.test(queryText.normalize("NFKC"))
  );
}

// The subject of a question: its content words without request words and
// without facet words such as 종류/방법/주의사항 ("혈액제제 종류" -> 혈액제제).
function subjectTerms(terms = []) {
  return terms.filter(
    (term) =>
      !COVERAGE_REQUEST_WORDS.has(term) &&
      !QUESTION_FOCUS_TERMS.has(term) &&
      !QUESTION_INTENT_ALIASES.has(term)
  );
}

// Spacing-insensitive matching for Korean (띄어쓰기 차이). Guideline PDFs
// often lose their spaces ("투석관삽입술") while staff type "투석관 삽입술",
// and the other way round. A Korean word of 2+ letters that has no exact
// token match is also looked for inside the text with every space removed.
const SPACING_TERM_PATTERN = /^[가-힣]{2,}$/u;

function compactText(text = "") {
  return String(text || "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\s+/gu, "");
}

// Facet words (방법, 종류, 절차 ...) appear inside countless longer words
// ("투여방법") and would make unrelated chunks look complete, so they only
// ever match as whole words.
function usesSpacingMatch(term = "") {
  return SPACING_TERM_PATTERN.test(term) && !QUESTION_FOCUS_TERMS.has(term);
}

function countOccurrences(haystack = "", needle = "") {
  if (!needle) return 0;
  let count = 0;
  let from = haystack.indexOf(needle);
  while (from >= 0) {
    count += 1;
    from = haystack.indexOf(needle, from + needle.length);
  }
  return count;
}

function matchedSubjectTerms(text = "", subjects = []) {
  if (!subjects.length) return 0;
  const tokens = tokenize(String(text || ""));
  const compact = compactText(text);
  return subjects.filter(
    (term) =>
      tokens.some((token) => tokenMatchesQueryTerm(token, term)) ||
      (usesSpacingMatch(term) && compact.includes(term))
  ).length;
}

const QUERY_ACTION_STEMS = new Set([
  "평가",
  "확인",
  "설명",
  "사용",
  "측정",
  "비교",
  "준비",
  "시행",
  "검사",
  "관찰",
  "기록",
  "투여",
  "중단",
  "처치",
]);
const PROCEDURE_REQUEST_ACTION_STEMS = new Set([
  "시행",
  "투여",
  "처치",
  "준비",
  "사용",
]);
const KOREAN_PARTICLES = [
  "에서",
  "으로",
  "부터",
  "까지",
  "에게",
  "이란",
  "란",
  "을",
  "를",
  "은",
  "는",
  "이",
  "가",
  "에",
  "로",
  "와",
  "과",
  "의",
  "도",
  "만",
];
const QUESTION_FOCUS_TERMS = new Set([
  "종류",
  "목적",
  "절차",
  "기준",
  "대상",
  "방법",
  "시점",
  "주의사항",
  "금기",
  "용량",
  "속도",
  "시간",
]);
const QUESTION_INTENT_ALIASES = new Map([
  ["종류", "types"],
  ["목적", "purpose"],
  ["절차", "procedure"],
  ["방법", "procedure"],
  ["순서", "procedure"],
  ["준비", "preparation"],
  ["준비사항", "preparation"],
  ["주의", "cautions"],
  ["주의사항", "cautions"],
  ["금기", "cautions"],
]);

function stripKoreanParticle(token = "") {
  for (const particle of KOREAN_PARTICLES) {
    if (token.endsWith(particle) && token.length - particle.length >= 2)
      return token.slice(0, -particle.length);
  }
  return token;
}

function normalizeKoreanQuestionAction(token = "") {
  const endings = [
    "해주세요",
    "해줘",
    "해요",
    "하나요",
    "합니까",
    "하는지",
    "할까요",
    "하려면",
    "해야",
    "하면",
    "한다",
    "하다",
    "해",
  ];
  for (const ending of endings) {
    if (!token.endsWith(ending)) continue;
    const stem = token.slice(0, -ending.length);
    if (QUERY_ACTION_STEMS.has(stem)) return stem;
  }
  return token;
}

function splitIntentSuffix(token = "") {
  if (QUESTION_INTENT_ALIASES.has(token)) return [token];
  const suffixes = [...QUESTION_INTENT_ALIASES.keys()].sort(
    (left, right) => right.length - left.length
  );
  for (const suffix of suffixes) {
    if (!token.endsWith(suffix)) continue;
    const subject = token.slice(0, -suffix.length);
    if (subject.length < 2) continue;
    return [stripKoreanParticle(subject), suffix];
  }
  return [token];
}

function queryTokens(text = "") {
  return [
    ...new Set(
      tokenize(text)
        .map(stripKoreanParticle)
        .map(normalizeKoreanQuestionAction)
        .flatMap(splitIntentSuffix)
        .filter((token) => token.length >= 2 && !QUERY_STOPWORDS.has(token))
    ),
  ];
}

function tokenMatchesQueryTerm(token = "", term = "") {
  if (token === term) return true;
  if (
    !/^[가-힣]+$/u.test(token) ||
    !/^[가-힣]+$/u.test(term) ||
    token.length < 2 ||
    term.length < 2
  )
    return false;
  return KOREAN_PARTICLES.some(
    (particle) => token === `${term}${particle}` || term === `${token}${particle}`
  );
}

function queryTermFrequency(tokens = [], term = "") {
  return tokens.reduce(
    (count, token) => count + (tokenMatchesQueryTerm(token, term) ? 1 : 0),
    0
  );
}

function weightedCoverage(terms = [], text = "") {
  if (!terms.length || typeof text !== "string") return 0;
  const normalized = text.normalize("NFKC").toLowerCase();
  let matched = 0;
  let total = 0;
  for (const term of terms) {
    const weight = QUESTION_FOCUS_TERMS.has(term) ? 2 : 1;
    total += weight;
    if (normalized.includes(term)) matched += weight;
  }
  return total > 0 ? matched / total : 0;
}

function detectQuestionIntent(text = "") {
  const terms = queryTokens(text);
  for (const token of terms) {
    const intent = QUESTION_INTENT_ALIASES.get(token);
    if (intent) return intent;
  }
  const normalized = String(text).normalize("NFKC");
  if (
    /어떻게\s*(?:해|해요|하나요|합니까|하는지|해야|하면)(?:[?!.。！？\s]|$)/.test(
      normalized
    )
  )
    return "procedure";
  if (
    normalized.includes("어떻게") &&
    terms.some((term) => PROCEDURE_REQUEST_ACTION_STEMS.has(term))
  )
    return "procedure";
  return null;
}

function evidenceResultLimit(queryText = "", configuredTopN = 4) {
  return detectQuestionIntent(queryText) === "procedure"
    ? Math.max(configuredTopN, 6)
    : configuredTopN;
}

const EXAMPLE_MATERIAL_PATTERN =
  /(?:예시|예제|샘플|교육용|연습용|작성\s*예|시나리오)/i;
const CICARE_PATTERN = /cicare/i;

function isNonAnswerMaterialCandidate(candidate = {}, queryText = "") {
  if (detectQuestionIntent(queryText) !== "procedure") return false;
  const normalizedQuery = String(queryText).normalize("NFKC");
  if (
    EXAMPLE_MATERIAL_PATTERN.test(normalizedQuery) ||
    CICARE_PATTERN.test(normalizedQuery)
  )
    return false;
  const label = [
    candidate.metadata?.section,
    candidate.metadata?.title,
    candidate.metadata?.document_name,
    candidate.text,
  ]
    .filter(Boolean)
    .join(" ")
    .normalize("NFKC");
  return EXAMPLE_MATERIAL_PATTERN.test(label) || CICARE_PATTERN.test(label);
}

function filterNonAnswerMaterialCandidates(candidates = [], queryText = "") {
  return candidates.filter(
    (candidate) => !isNonAnswerMaterialCandidate(candidate, queryText)
  );
}

function normalizeEvidenceKeyPart(value = "") {
  return String(value)
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function publicEvidenceKey(candidate = {}) {
  const text = normalizeEvidenceKeyPart(candidate.text);
  if (!text) return `id:${candidate.id || ""}`;
  const metadata = candidate.metadata || {};
  const sourceName = normalizeEvidenceKeyPart(
    metadata.document_name || metadata.documentName || metadata.title || ""
  );
  const page = normalizeEvidenceKeyPart(metadata.page ?? "");
  const section = normalizeEvidenceKeyPart(metadata.section || "");
  if (!sourceName && !page && !section) return `id:${candidate.id || ""}`;
  return [
    normalizeEvidenceKeyPart(metadata.content_type || "text"),
    sourceName,
    page,
    section,
    text,
  ].join("\u0000");
}

function dedupePublicEvidence(candidates = []) {
  const seen = new Set();
  return candidates.filter((candidate) => {
    const key = publicEvidenceKey(candidate);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function questionIntentAliases(intent = null) {
  if (!intent) return [];
  return [...QUESTION_INTENT_ALIASES.entries()]
    .filter(([, value]) => value === intent)
    .map(([alias]) => alias);
}

function directlyMatchesSubjectIntent(candidate = {}, queryText = "") {
  const intent = detectQuestionIntent(queryText);
  const aliases = questionIntentAliases(intent);
  const subjectTerms = queryTokens(queryText).filter(
    (token) => !QUESTION_INTENT_ALIASES.has(token)
  );
  if (!aliases.length || !subjectTerms.length) return false;
  const sectionTerms = new Set(queryTokens(candidate.metadata?.section || ""));
  return (
    subjectTerms.every((term) => sectionTerms.has(term)) &&
    aliases.some((alias) => sectionTerms.has(alias))
  );
}

const CHAPTER_SUBJECT_SUFFIXES = ["간호", "요법", "관리", "치료", "지침"];
const CHAPTER_HEADING_PATTERN = /^\s*(?:#{1,2}\s+|\d+\.\s+)/u;
const HEADING_PATTERN =
  /^\s*(?:#{1,6}\s+|\d+(?:\.\d+)*[.)]\s*)/u;

function chapterHeadingMatchesSubject(line = "", subjectTerms = []) {
  if (!CHAPTER_HEADING_PATTERN.test(line) || !subjectTerms.length) return false;
  const headingTokens = tokenize(line.replace(CHAPTER_HEADING_PATTERN, ""))
    .map(stripKoreanParticle)
    .filter((token) => token.length >= 2);
  const usedIndexes = new Set();
  let hasStructuralSuffix = false;
  for (const term of subjectTerms) {
    const matchingIndex = headingTokens.findIndex((token, index) => {
      if (usedIndexes.has(index)) return false;
      if (tokenMatchesQueryTerm(token, term)) return true;
      const suffix = CHAPTER_SUBJECT_SUFFIXES.find(
        (candidate) => token === `${term}${candidate}`
      );
      if (!suffix) return false;
      hasStructuralSuffix = true;
      return true;
    });
    if (matchingIndex < 0) return false;
    usedIndexes.add(matchingIndex);
  }
  for (const [index, token] of headingTokens.entries()) {
    if (usedIndexes.has(index)) continue;
    if (!CHAPTER_SUBJECT_SUFFIXES.includes(token)) return false;
    hasStructuralSuffix = true;
  }
  return hasStructuralSuffix;
}

function headingMatchesIntent(line = "", intent = null) {
  if (!intent || !HEADING_PATTERN.test(line)) return false;
  const headingTerms = new Set(queryTokens(line));
  return questionIntentAliases(intent).some((alias) => headingTerms.has(alias));
}

function chapterScopedSubjectIntent(candidate = {}, queryText = "") {
  const intent = detectQuestionIntent(queryText);
  // Broad 종류/목적 questions often have a chapter heading and a following
  // subsection heading. Procedure questions already use workflow expansion.
  if (!new Set(["types", "purpose"]).has(intent)) return false;
  const subjectTerms = queryTokens(queryText).filter(
    (token) => !QUESTION_INTENT_ALIASES.has(token)
  );
  if (!subjectTerms.length) return false;
  const lines = String(candidate.text || "")
    .normalize("NFKC")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (
    !lines.some((line) => chapterHeadingMatchesSubject(line, subjectTerms))
  )
    return false;
  return lines.some((line) => headingMatchesIntent(line, intent));
}

function trailingIntentHeading(text = "", queryText = "") {
  const intent = detectQuestionIntent(queryText);
  if (!intent || typeof text !== "string") return "";
  const aliases = {
    types: ["종류"],
    purpose: ["목적"],
    procedure: ["절차", "방법", "순서"],
    preparation: ["준비", "준비사항"],
    cautions: ["주의", "주의사항", "금기"],
  }[intent];
  const lastLine = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .at(-1);
  if (!lastLine || lastLine.length > 120) return "";
  const normalized = lastLine
    .replace(/^#{1,6}\s+/, "")
    .replace(/^\d+(?:\.\d+)*[.)]?\s+/, "")
    .trim();
  return aliases.some((alias) => normalized.includes(alias)) ? lastLine : "";
}

function addHeadingContinuationCandidates(
  selected = [],
  corpusDocuments = [],
  { queryText = "", topN = 4 } = {}
) {
  if (!detectQuestionIntent(queryText) || !selected.length) return selected;
  const byPosition = new Map(
    corpusDocuments
      .filter((document) => Number.isFinite(document.corpusPosition))
      .map((document) => [document.corpusPosition, document])
  );
  const included = new Set(selected.map((candidate) => candidate.id));
  const expanded = [];
  for (const candidate of selected) {
    expanded.push(candidate);
    const heading = trailingIntentHeading(candidate.text, queryText);
    if (!heading || !Number.isFinite(candidate.corpusPosition)) continue;
    const continuation = byPosition.get(candidate.corpusPosition + 1);
    if (!continuation || included.has(continuation.id)) continue;
    if (isNonAnswerMaterialCandidate(continuation, queryText)) continue;
    const currentDocumentId =
      candidate.metadata?.document_id || candidate.metadata?.docId || "";
    const continuationDocumentId =
      continuation.metadata?.document_id || continuation.metadata?.docId || "";
    if (!currentDocumentId || currentDocumentId !== continuationDocumentId)
      continue;
    expanded.push({
      ...continuation,
      metadata: {
        ...continuation.metadata,
        section: continuation.metadata?.section || heading,
      },
      retrieval: {
        ...(candidate.retrieval || {}),
        expandedFromHeading: true,
      },
    });
    included.add(continuation.id);
  }
  return dedupePublicEvidence(expanded).slice(0, topN);
}

function procedureBranch(value = "") {
  const normalized = String(value).normalize("NFKC");
  const adult = normalized.includes("성인");
  const pediatric = normalized.includes("소아");
  if (adult && !pediatric) return "adult";
  if (pediatric && !adult) return "pediatric";
  return "common";
}

function addProcedureWorkflowCandidates(
  selected = [],
  corpusDocuments = [],
  { queryText = "", topN = 4 } = {}
) {
  if (detectQuestionIntent(queryText) !== "procedure" || !selected.length)
    return selected;
  const subjectTerms = queryTokens(queryText).filter(
    (token) => !QUESTION_INTENT_ALIASES.has(token)
  );
  if (!subjectTerms.length) return selected;

  const byId = new Map(corpusDocuments.map((document) => [document.id, document]));
  const anchor = byId.get(selected[0].id) || selected[0];
  if (!Number.isFinite(anchor.corpusPosition)) return selected;
  const documentId =
    anchor.metadata?.document_id || anchor.metadata?.docId || "";
  const anchorLabel = `${anchor.metadata?.section || ""} ${anchor.text || ""}`;
  const anchorBranch = procedureBranch(anchorLabel);
  const excludedSection = /(?:목적|규정|정의|대상|범위)$/;
  const narrowSubprocedure = /(?:수집|세척|폐기|보관|처리)\s*(?:방법|절차|법)/;
  const workflowSection =
    /(?:절차|방법|순서|확인|기록|평가|준비|시행|관찰|회복|퇴실|종료|치료)/;
  const workflowAction =
    /(?:처방|동의|평가|준비|확인|신청|수령|시행|투여|측정|관찰|회복|퇴실|종료|기록)/;
  const maximumCorpusDistance = 12;

  function isCompatible(document) {
    const candidateDocumentId =
      document?.metadata?.document_id || document?.metadata?.docId || "";
    if (!documentId || candidateDocumentId !== documentId) return false;
    const section = String(document.metadata?.section || "").normalize("NFKC");
    const text = String(document.text || "").normalize("NFKC");
    const label = section || text;
    if (isNonAnswerMaterialCandidate(document, queryText)) return false;
    if (section && excludedSection.test(section)) return false;
    if (!workflowSection.test(label)) return false;
    if (!subjectTerms.every((term) => label.includes(term))) return false;
    if (!section && !workflowAction.test(text)) return false;
    if (
      !section &&
      narrowSubprocedure.test(text) &&
      !queryTokens(queryText).some((term) =>
        /(?:수집|세척|폐기|보관|처리)/.test(term)
      )
    )
      return false;
    const branch = procedureBranch(label);
    return anchorBranch === "common"
      ? branch === "common"
      : branch === "common" || branch === anchorBranch;
  }

  const selectedIds = new Set(selected.map(({ id }) => id));
  const workflowCandidates = corpusDocuments.filter(
    (candidate) =>
      Number.isFinite(candidate.corpusPosition) &&
      candidate.corpusPosition >= anchor.corpusPosition &&
      candidate.corpusPosition - anchor.corpusPosition <= maximumCorpusDistance &&
      isCompatible(candidate)
  );
  const workflowIds = new Set(
    workflowCandidates
      .filter((candidate) => candidate.id !== anchor.id)
      .map(({ id }) => id)
  );
  const additions = workflowCandidates
    .filter((candidate) => !selectedIds.has(candidate.id))
    .sort((left, right) => left.corpusPosition - right.corpusPosition)
    .slice(0, Math.max(0, topN - selected.length));
  const markContinuation = (candidate) => ({
    ...candidate,
    metadata: {
      ...candidate.metadata,
      schat_procedure_workflow_continuation: true,
    },
    retrieval: {
      ...(selected[0].retrieval || {}),
      expandedFromProcedureWorkflow: true,
    },
  });
  const markedSelected = selected.map((candidate) =>
    workflowIds.has(candidate.id) ? markContinuation(candidate) : candidate
  );
  const markedAdditions = additions.map(markContinuation);
  return dedupePublicEvidence(
    [...markedSelected, ...markedAdditions].sort((left, right) => {
      const leftPosition = byId.get(left.id)?.corpusPosition ?? left.corpusPosition;
      const rightPosition =
        byId.get(right.id)?.corpusPosition ?? right.corpusPosition;
      if (Number.isFinite(leftPosition) && Number.isFinite(rightPosition))
        return leftPosition - rightPosition;
      return 0;
    })
  ).slice(0, topN);
}

function filterIntentFocusedCandidates(
  ranked = [],
  { queryText = "", minimumRelativeFusionScore = 0.7 } = {}
) {
  if (!detectQuestionIntent(queryText)) return ranked;
  const chapterCandidates = ranked.filter((candidate) =>
    chapterScopedSubjectIntent(candidate, queryText)
  );
  const directCandidates = ranked.filter((candidate) =>
    directlyMatchesSubjectIntent(candidate, queryText)
  );
  const candidates = chapterCandidates.length
    ? chapterCandidates
    : directCandidates.length
      ? directCandidates
      : ranked;
  if (candidates.length < 2) return candidates;
  const bestFusionScore = candidates.reduce(
    (best, candidate) =>
      Math.max(best, candidate.retrieval?.fusionScore ?? 0),
    0
  );
  if (bestFusionScore <= 0) return candidates;
  const minimumScore = bestFusionScore * minimumRelativeFusionScore;
  return candidates.filter(
    (candidate) => (candidate.retrieval?.fusionScore ?? 0) >= minimumScore
  );
}

function stableDocumentOrder(left, right) {
  const leftPosition = Number.isFinite(left.corpusPosition)
    ? left.corpusPosition
    : Number.MAX_SAFE_INTEGER;
  const rightPosition = Number.isFinite(right.corpusPosition)
    ? right.corpusPosition
    : Number.MAX_SAFE_INTEGER;
  if (leftPosition !== rightPosition) return leftPosition - rightPosition;
  return String(left.id).localeCompare(String(right.id));
}

// Token index per corpus array. The chunk list SCHAT passes in is reused
// between searches while documents are unchanged (see searchCache.js), so
// tokenising every chunk and counting each query term is done once per
// corpus version instead of on every search. Scores and order are unchanged.
const bm25Indexes = new WeakMap();

function bm25IndexFor(documents) {
  const cached = bm25Indexes.get(documents);
  if (cached) return cached;
  const uniqueDocuments = dedupePublicEvidence(documents);
  const prepared = uniqueDocuments.map((document, corpusPosition) => {
    const tokens = tokenize(document.text);
    return {
      ...document,
      corpusPosition: Number.isFinite(document.corpusPosition)
        ? document.corpusPosition
        : corpusPosition,
      tokenCount: tokens.length,
      tokens,
      compact: compactText(document.text),
    };
  });
  const averageLength =
    prepared.reduce((sum, document) => sum + document.tokenCount, 0) /
      prepared.length || 1;
  const index = {
    prepared,
    averageLength,
    // term -> Int32Array of per-document frequencies (same order as prepared)
    frequencies: new Map(),
    documentFrequency: new Map(),
  };
  if (Array.isArray(documents) && Object.isExtensible(documents))
    bm25Indexes.set(documents, index);
  return index;
}

function termFrequencies(index, term) {
  let frequencies = index.frequencies.get(term);
  if (!frequencies) {
    frequencies = Int32Array.from(index.prepared, (document) =>
      queryTermFrequency(document.tokens, term)
    );
    index.frequencies.set(term, frequencies);
    index.documentFrequency.set(
      term,
      frequencies.reduce((count, value) => count + (value > 0 ? 1 : 0), 0)
    );
  }
  return frequencies;
}

// Spacing-insensitive occurrences of a Korean word (0 where the word already
// matches a token exactly; those documents keep their exact score).
function spacingFrequencies(index, term) {
  const key = `\u0000spacing:${term}`;
  let frequencies = index.frequencies.get(key);
  if (!frequencies) {
    const exact = termFrequencies(index, term);
    frequencies = usesSpacingMatch(term)
      ? Int32Array.from(index.prepared, (document, position) =>
          exact[position] > 0 ? 0 : countOccurrences(document.compact, term)
        )
      : new Int32Array(index.prepared.length);
    index.frequencies.set(key, frequencies);
    index.documentFrequency.set(
      key,
      frequencies.reduce((count, value) => count + (value > 0 ? 1 : 0), 0)
    );
  }
  return frequencies;
}

// A 2-letter word found only inside a longer word ("관찰" in "관찰사항") is
// counted only in a chunk that already matches another word of the question;
// 3+ letter words ("투석관", "흉수천자") count on their own.
const SPACING_STRONG_LENGTH = 3;

// One BM25 token form for a synonym word ("chest tube" -> two tokens, so it
// is not used for word matching; checklist names still use it).
function singleTokenForm(word = "") {
  const tokens = tokenize(String(word));
  if (tokens.length > 1 && tokens.every((token) => usesSpacingMatch(token)))
    return tokens.join("");
  return tokens.join(" ");
}

function rankByBm25(
  query = "",
  documents = [],
  { k1 = 1.5, b = 0.75, synonymGroups = [] } = {}
) {
  const terms = queryTokens(query);
  if (terms.length === 0) return [];
  const index = bm25IndexFor(documents);
  const { prepared, averageLength } = index;
  if (prepared.length === 0) return [];

  // Active synonyms (동의어 사전): each query term may also match the other
  // words of its group. A group counts as one word of the question and only
  // its best-matching word adds to the score, so a question without synonyms
  // is scored exactly as before.
  const alternatives = synonymGroups.length
    ? termAlternatives(terms, synonymGroups, singleTokenForm)
    : null;
  const alternativesOf = (token) => alternatives?.get(token) || [token];

  const documentFrequency = new Map();
  const frequencyByTerm = new Map();
  const spacingByTerm = new Map();
  for (const token of terms)
    for (const word of alternativesOf(token)) {
      frequencyByTerm.set(word, termFrequencies(index, word));
      spacingByTerm.set(word, spacingFrequencies(index, word));
      const exactDocuments = index.documentFrequency.get(word) || 0;
      // Exact matches keep their usual weight; a word that appears only
      // without spaces is weighted by how many chunks contain it that way.
      documentFrequency.set(
        word,
        exactDocuments ||
          index.documentFrequency.get(`\u0000spacing:${word}`) ||
          0
      );
    }

  const contentTerms = new Set(coverageTerms(terms));
  return prepared
    .map((document, position) => {
      let bm25Score = 0;
      let matchedQueryTokens = 0;
      let matchedContentTerms = 0;
      const frequencyOf = (word, allowShort) => {
        const exact = frequencyByTerm.get(word)[position];
        if (exact > 0) return exact;
        const spaced = spacingByTerm.get(word)[position];
        if (spaced === 0) return 0;
        return word.length >= SPACING_STRONG_LENGTH || allowShort ? spaced : 0;
      };
      // Does this chunk match a specific (3+ letter) word of the question?
      const strongMatch = terms.some((token) =>
        alternativesOf(token).some(
          (word) =>
            word.length >= SPACING_STRONG_LENGTH && frequencyOf(word, false) > 0
        )
      );
      for (const token of terms) {
        let best = 0;
        let matched = false;
        for (const word of alternativesOf(token)) {
          const frequency = frequencyOf(word, strongMatch);
          if (frequency === 0) continue;
          matched = true;
          const matchedDocuments = documentFrequency.get(word) || 0;
          const inverseDocumentFrequency = Math.log(
            1 +
              (prepared.length - matchedDocuments + 0.5) /
                (matchedDocuments + 0.5)
          );
          const lengthNormalization =
            frequency +
            k1 * (1 - b + b * (document.tokenCount / averageLength));
          best = Math.max(
            best,
            inverseDocumentFrequency *
              ((frequency * (k1 + 1)) / lengthNormalization)
          );
        }
        if (!matched) continue;
        matchedQueryTokens += 1;
        if (contentTerms.has(token)) matchedContentTerms += 1;
        bm25Score += best;
      }
      const { tokenCount, tokens, compact, ...result } = document;
      const sectionCoverage = weightedCoverage(
        terms,
        document.metadata?.section || ""
      );
      const titleCoverage = weightedCoverage(
        terms,
        document.metadata?.title || document.metadata?.document_name || ""
      );
      return {
        ...result,
        bm25Score: bm25Score * (1 + sectionCoverage + titleCoverage * 0.25),
        bm25Coverage: matchedContentTerms / contentTerms.size,
        sectionCoverage,
        titleCoverage,
      };
    })
    .filter((document) => document.bm25Score > 0)
    .sort((left, right) => {
      if (right.bm25Score !== left.bm25Score)
        return right.bm25Score - left.bm25Score;
      return stableDocumentOrder(left, right);
    });
}

function fuseGeminiAndBm25(
  vectorRanked = [],
  bm25Ranked = [],
  {
    topN = 4,
    vectorWeight = 0.75,
    bm25Weight = 0.25,
    queryText = "",
    maxImageResults = Number.POSITIVE_INFINITY,
  } = {}
) {
  const eligibleVectorRanked = dedupePublicEvidence(
    filterNonAnswerMaterialCandidates(vectorRanked, queryText)
  );
  const eligibleBm25Ranked = dedupePublicEvidence(
    filterNonAnswerMaterialCandidates(bm25Ranked, queryText)
  );
  const candidates = new Map();

  eligibleVectorRanked.forEach((candidate, index) => {
    candidates.set(publicEvidenceKey(candidate), {
      ...candidate,
      retrieval: {
        vectorRank: index + 1,
        bm25Rank: null,
        vectorScore: candidate.vectorScore ?? null,
        bm25Score: null,
        bm25Coverage: 0,
        sectionCoverage: 0,
        fusionScore: vectorWeight / (index + 1),
      },
    });
  });

  eligibleBm25Ranked.forEach((candidate, index) => {
    const evidenceKey = publicEvidenceKey(candidate);
    const existing = candidates.get(evidenceKey) || {
      ...candidate,
      retrieval: {
        vectorRank: null,
        bm25Rank: null,
        vectorScore: null,
        bm25Score: null,
        bm25Coverage: 0,
        sectionCoverage: 0,
        fusionScore: 0,
      },
    };
    existing.retrieval.bm25Rank = index + 1;
    existing.retrieval.bm25Score = candidate.bm25Score ?? null;
    existing.retrieval.bm25Coverage = candidate.bm25Coverage ?? 0;
    existing.retrieval.sectionCoverage = candidate.sectionCoverage ?? 0;
    if (Number.isFinite(candidate.corpusPosition))
      existing.corpusPosition = candidate.corpusPosition;
    existing.retrieval.fusionScore += bm25Weight / (index + 1);
    candidates.set(evidenceKey, existing);
  });

  const ranked = Array.from(candidates.values()).sort((left, right) => {
    if (right.retrieval.fusionScore !== left.retrieval.fusionScore)
      return right.retrieval.fusionScore - left.retrieval.fusionScore;
    const leftVectorRank = left.retrieval.vectorRank ?? Number.MAX_SAFE_INTEGER;
    const rightVectorRank =
      right.retrieval.vectorRank ?? Number.MAX_SAFE_INTEGER;
    if (leftVectorRank !== rightVectorRank)
      return leftVectorRank - rightVectorRank;
    const leftBm25Rank = left.retrieval.bm25Rank ?? Number.MAX_SAFE_INTEGER;
    const rightBm25Rank = right.retrieval.bm25Rank ?? Number.MAX_SAFE_INTEGER;
    if (leftBm25Rank !== rightBm25Rank) return leftBm25Rank - rightBm25Rank;
    return stableDocumentOrder(left, right);
  });
  const queryFocused = filterImageCandidatesByQueryFocus(ranked, { queryText });
  const relevant = filterWeakHybridTail(queryFocused, { queryText });
  const focused = filterIntentFocusedCandidates(relevant, { queryText });
  return limitImageDescriptionCandidates(focused, {
    maxImageResults,
  }).slice(0, topN);
}

function uppercaseIdentifiers(text = "") {
  if (typeof text !== "string") return [];
  return [
    ...new Set(
      (text.normalize("NFKC").match(/\b[A-Z][A-Z0-9-]{1,}\b/g) || []).map(
        (value) => value.toUpperCase()
      )
    ),
  ];
}

function explicitlySelectedImageTools(text = "") {
  if (typeof text !== "string") return [];
  const selected = new Set();
  const pattern =
    /([A-Z][A-Z0-9-]{1,})[이가은는]?\s*선택(?:된|되어|됨|했습니다|되었습니다)?/g;
  for (const match of text.normalize("NFKC").matchAll(pattern))
    selected.add(match[1].toUpperCase());
  return [...selected];
}

function filterImageCandidatesByQueryFocus(
  candidates = [],
  { queryText = "" } = {}
) {
  const queryTools = uppercaseIdentifiers(queryText);
  if (!queryTools.length) return candidates;
  return candidates.filter((candidate) => {
    if (candidate?.metadata?.content_type !== "image_description") return true;
    const selectedTools = explicitlySelectedImageTools(candidate.text);
    if (!selectedTools.length) return true;
    return selectedTools.some((tool) => queryTools.includes(tool));
  });
}

function filterWeakHybridTail(
  ranked = [],
  {
    maximumVectorGap = 0.2,
    minimumBm25Coverage = 2 / 3,
    minimumStandaloneVectorScore = 0.7,
    minimumSemanticSupplementScore = 0.8,
    imageRequestMinimumVectorScore = 0.6,
    imageRequestMaximumVectorGap = 0.05,
    queryText = "",
  } = {}
) {
  const terms = queryTokens(queryText);
  const bestExactCoverage = ranked.reduce(
    (best, candidate) =>
      Math.max(best, candidate.retrieval?.bm25Coverage ?? 0),
    0
  );
  const bestVectorScore = ranked.reduce((best, candidate) => {
    const score = candidate.vectorScore ?? candidate.retrieval?.vectorScore;
    return Number.isFinite(score) ? Math.max(best, score) : best;
  }, Number.NEGATIVE_INFINITY);

  // A clinical abbreviation in the question (e.g. PTNB) is very specific: a
  // chunk that contains every such abbreviation is kept even when a generic
  // word of the question ("간호") is missing from that chunk.
  const abbreviations = uppercaseIdentifiers(queryText).filter(
    (value) => value.length >= 3
  );
  const containsAbbreviations = (candidate) => {
    const text = String(candidate?.text || "").normalize("NFKC");
    return (
      abbreviations.length > 0 &&
      abbreviations.every((value) =>
        new RegExp(
          `(^|[^A-Za-z0-9])${value.replace(/[-]/g, "\\-")}([^A-Za-z0-9]|$)`
        ).test(text)
      )
    );
  };

  // Picture questions only: descriptions and tables rarely repeat facet
  // words such as "종류", so a chunk that holds every subject word of the
  // question and is (almost) the best semantic match is kept. A question
  // whose subject is not in the guidelines (라식, 엘보 ...) can never match.
  const imageSubjects = isImageRequest(queryText) ? subjectTerms(terms) : [];
  const subjectAtTop = (candidate, vectorScore) =>
    imageSubjects.length > 0 &&
    Number.isFinite(vectorScore) &&
    vectorScore >= imageRequestMinimumVectorScore &&
    Number.isFinite(bestVectorScore) &&
    bestVectorScore - vectorScore <= imageRequestMaximumVectorGap &&
    matchedSubjectTerms(candidate?.text, imageSubjects) ===
      imageSubjects.length;

  return ranked.filter((candidate) => {
    const bm25Coverage = candidate.retrieval?.bm25Coverage ?? 0;
    if (bm25Coverage >= minimumBm25Coverage) return true;
    if (containsAbbreviations(candidate)) return true;
    const vectorScore =
      candidate.vectorScore ?? candidate.retrieval?.vectorScore ?? null;
    if (subjectAtTop(candidate, vectorScore)) return true;
    const strongSemantic =
      Number.isFinite(vectorScore) &&
      vectorScore >= minimumStandaloneVectorScore &&
      Number.isFinite(bestVectorScore) &&
      bestVectorScore - vectorScore <= maximumVectorGap;
    if (!strongSemantic) return false;
    if (terms.length && bestExactCoverage >= minimumBm25Coverage)
      return vectorScore >= minimumSemanticSupplementScore;
    return true;
  });
}

function limitImageDescriptionCandidates(
  candidates = [],
  { maxImageResults = 1 } = {}
) {
  const limit = Math.max(0, Number(maxImageResults) || 0);
  let imageCount = 0;
  return candidates.filter((candidate) => {
    if (candidate?.metadata?.content_type !== "image_description") return true;
    if (imageCount >= limit) return false;
    imageCount += 1;
    return true;
  });
}

function evidencePageKey(item = {}) {
  const metadata = item.metadata || item;
  const document = String(
    metadata.document_id || metadata.documentId || metadata.document_name || ""
  );
  const page = String(metadata.page ?? "").trim();
  return document && page ? `${document}|${page}` : null;
}

/**
 * Picture questions only: images printed on a page that is already selected
 * as text evidence are added as related-image candidates when they mention
 * the most specific subject word of the question (the one found in the
 * fewest chunks, e.g. "세트" rather than "수혈"). The page itself was
 * validated by the normal retrieval filters, so no new page can enter.
 */
function addSamePageImageCandidates(
  relatedImageSources = [],
  {
    evidence = [],
    candidates = [],
    corpus = [],
    queryText = "",
    maxImages = 3,
  } = {}
) {
  const evidencePages = new Set(
    evidence
      .filter(
        (candidate) => candidate?.metadata?.content_type !== "image_description"
      )
      .map(evidencePageKey)
      .filter(Boolean)
  );
  const subjects = subjectTerms(queryTokens(queryText));
  if (!evidencePages.size || !subjects.length) return relatedImageSources;
  const index = bm25IndexFor(corpus);
  const specificSubject = subjects
    .map((term) => {
      termFrequencies(index, term);
      return { term, df: index.documentFrequency.get(term) || 0 };
    })
    .filter(({ df }) => df > 0)
    .sort((left, right) => left.df - right.df)[0]?.term;
  if (!specificSubject) return relatedImageSources;

  const result = [...relatedImageSources];
  const seen = new Set(result.map((source) => String(source.id)));
  for (const candidate of candidates) {
    if (result.length >= maxImages) break;
    if (candidate?.metadata?.content_type !== "image_description") continue;
    if (seen.has(String(candidate.id))) continue;
    if (!evidencePages.has(evidencePageKey(candidate))) continue;
    if (matchedSubjectTerms(candidate.text, [specificSubject]) === 0) continue;
    seen.add(String(candidate.id));
    result.push({
      ...candidate.metadata,
      id: candidate.id,
      text: candidate.text,
    });
  }
  return result;
}

module.exports = {
  addSamePageImageCandidates,
  tokenize,
  queryTokens,
  coverageTerms,
  COVERAGE_REQUEST_WORDS,
  isImageRequest,
  subjectTerms,
  matchedSubjectTerms,
  compactText,
  detectQuestionIntent,
  evidenceResultLimit,
  trailingIntentHeading,
  addHeadingContinuationCandidates,
  addProcedureWorkflowCandidates,
  filterIntentFocusedCandidates,
  rankByBm25,
  fuseGeminiAndBm25,
  filterImageCandidatesByQueryFocus,
  filterWeakHybridTail,
  limitImageDescriptionCandidates,
};
