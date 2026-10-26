import { isNoEvidenceAnswer } from "./citationFilter.js";

export function normalizeChecklistQuestion(value = "") {
  return String(value)
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^0-9a-z가-힣]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Position in the space-free question for an index of the normalized one, so
// Korean and English matches can be compared on one axis.
function compactIndex(normalized, index) {
  return normalized.slice(0, index).replace(/ /g, "").length;
}

/**
 * Returns the question spans (space-free coordinates) matched by an alias.
 * English-only aliases need word boundaries so a short abbreviation such as
 * "CT" never matches inside another word; Korean names ignore spacing.
 */
function aliasSpans(normalizedQuestion, alias) {
  const normalizedAlias = normalizeChecklistQuestion(alias);
  if (!normalizedAlias) return [];
  const spans = [];
  if (/^[0-9a-z ]+$/u.test(normalizedAlias)) {
    const body = normalizedAlias.split(" ").map(escapeRegExp).join(" ?");
    const pattern = new RegExp(`(^|[^0-9a-z])(${body})(?=$|[^0-9a-z])`, "gu");
    for (const match of normalizedQuestion.matchAll(pattern)) {
      const start = match.index + match[1].length;
      const end = start + match[2].length;
      spans.push([
        compactIndex(normalizedQuestion, start),
        compactIndex(normalizedQuestion, end),
      ]);
    }
    return spans;
  }
  const question = normalizedQuestion.replace(/ /g, "");
  const needle = normalizedAlias.replace(/ /g, "");
  if (needle.length < 2) return spans;
  // Korean names must start a word: "혈관조영술" must not fire inside
  // "뇌혈관조영술", while particles after the name ("신루설치술 후") still match.
  const wordStarts = new Set([0]);
  let compactPosition = 0;
  for (let index = 0; index < normalizedQuestion.length; index += 1) {
    if (normalizedQuestion[index] === " ") wordStarts.add(compactPosition);
    else compactPosition += 1;
  }
  let from = question.indexOf(needle);
  while (from >= 0) {
    if (wordStarts.has(from)) spans.push([from, from + needle.length]);
    from = question.indexOf(needle, from + 1);
  }
  return spans;
}

// Opposite procedure actions (same words as the server synonym rules).
const ACTION_WORDS = {
  insert: ["삽입", "거치", "설치", "insertion", "insert"],
  remove: ["제거", "발거", "remove", "removal"],
};

function actionsIn(text = "") {
  const lower = String(text).normalize("NFKC").toLowerCase();
  return Object.keys(ACTION_WORDS).filter((action) =>
    ACTION_WORDS[action].some((word) => lower.includes(word))
  );
}

/**
 * A checklist found only through an everyday or synonym name
 * (searchAliases) is not shown when the question asks for the opposite
 * action, e.g. "HD 카테터 제거" never opens the insertion checklist.
 */
function oppositeAction(question, checklist) {
  const asked = actionsIn(question);
  if (asked.length !== 1) return false;
  const own = actionsIn(checklist?.title);
  return own.length > 0 && !own.includes(asked[0]);
}

// A procedure name can also be a device name (PICC). "MRI는 PICC 사용
// 가능해?" or "MRI PICC 가능해?" asks about using the device, not about doing the procedure, so
// no checklist is offered when the question has a usage word and no
// procedure word. "PICC", "PICC 삽입 준비", "PICC 드레싱" still match.
const USAGE_WORDS = [
  "사용",
  "써도",
  "쓸수",
  "써야",
  "채혈",
  "주입",
  "연결",
  // "MRI PICC 가능해?", "CT PICC 괜찮아?"
  "가능",
  "괜찮",
  "안전",
  "허용",
  // Dressing is care of a line already in place, not the insertion checklist.
  "드레싱",
];
const PROCEDURE_WORDS = [
  "삽입",
  "거치",
  "설치",
  "시술",
  "준비",
  "간호",
  "동의서",
  "체크리스트",
  "insertion",
  "insert",
];

export function asksDeviceUseOnly(question = "") {
  const normalized = normalizeChecklistQuestion(question);
  const compact = normalized.replace(/ /g, "");
  if (!USAGE_WORDS.some((word) => compact.includes(word))) return false;
  if (PROCEDURE_WORDS.some((word) => compact.includes(word))) return false;
  // 전/후 as their own word ("검사 전", "시술 후에"), not inside "전화".
  return !/(^| )(전|후)(에|에는|부터|까지)?( |$)/u.test(normalized);
}

// One document across editions: "수술(260306).pdf" and "수술(26.09.10).pdf"
// are both "수술".
function documentFamily(filename = "") {
  return String(filename)
    .normalize("NFKC")
    .replace(/\.[a-z0-9]+$/iu, "")
    .replace(/\([^)]*\d[^)]*\)/gu, "")
    .replace(/[\s_]+/gu, "")
    .toLowerCase();
}

// Documents the answer actually quoted (server-verified evidenceQuotes), or
// null when the answer carries no quote record (old chats, unquoted answers).
function quotedDocuments(sources) {
  if (!Array.isArray(sources)) return null;
  const quoted = sources.filter(
    (source) => Array.isArray(source?.evidenceQuotes) && source.evidenceQuotes.length > 0
  );
  if (quoted.length === 0) return null;
  return new Set(
    quoted.map((source) => documentFamily(source.documentName || source.document_name))
  );
}

/**
 * "CAG는 당일수술이야?" quotes only the nursing-needs document: the CAG
 * procedure checklist is not offered when the answer quoted other documents.
 */
function citedByAnswer(checklist, quoted) {
  const filename = checklist?.source?.filename;
  return !quoted || !filename || quoted.has(documentFamily(filename));
}

// 간호필요도 입력·평가를 묻는 질문("PCI는 당일수술여부에 수술로 입력해?")은 시술 이름이 있어도
// 시술 준비를 묻는 것이 아니므로 체크리스트를 띄우지 않는다(2026-10-27).
// "PCI 준비", "PCI 체크리스트"처럼 준비를 함께 물으면 그대로 띄운다.
const NURSING_NEED_WORDS = /간호\s*필요도|필요도|당일\s*수술|수술\s*여부|수술로\s*(?:입력|봐|보|인정|평가|체크)|수술\s*(?:실시|미실시)/u;
const PREPARATION_WORDS = /준비|체크\s*리스트|동의서|금식|시술\s*전|검사\s*전|수술\s*전|시술\s*후|검사\s*후|간호(?!\s*필요도)/u;

export function asksNursingNeedOnly(question = "") {
  const text = String(question).normalize("NFKC");
  return NURSING_NEED_WORDS.test(text) && !PREPARATION_WORDS.test(text);
}

/**
 * 관리자 '질문별 답변'에서 저장된 답변에 직원 화면과 같은 체크리스트 버튼이 떴는지 계산한다.
 * 직원 채팅 화면과 같은 규칙(matchChecklists)과 같은 공개 체크리스트 목록을 쓴다.
 */
export function checklistsForStoredAnswer(question = "", answer = null, checklists = []) {
  if (!answer?.available) return [];
  return matchChecklists(question || "", checklists, {
    content: answer.text,
    sources: answer.sources,
    searchOutcome: answer.searchOutcome || undefined,
    closed: true,
  });
}

export function matchChecklists(question = "", checklists = [], response) {
  // Use the same no-evidence decision as the citation display, including old chats.
  if (response && (
    !String(response.content || "").trim() || response.error || response.pending ||
    (response.animate && !response.closed) ||
    (response.searchOutcome?.version === 2 && response.searchOutcome.status === "not_found") ||
    isNoEvidenceAnswer(response.content)
  )) return [];
  const normalizedQuestion = normalizeChecklistQuestion(question);
  if (!normalizedQuestion || asksDeviceUseOnly(question) || asksNursingNeedOnly(question)) return [];
  const quoted = quotedDocuments(response?.sources);

  const matches = (Array.isArray(checklists) ? checklists : [])
    .filter((checklist) => checklist?.active !== false)
    .filter((checklist) => citedByAnswer(checklist, quoted))
    .map((checklist) => {
      const ownSpans = (checklist?.aliases || []).flatMap((alias) =>
        aliasSpans(normalizedQuestion, alias)
      );
      // searchAliases: everyday/synonym names from the server (find only)
      const searchSpans = (checklist?.searchAliases || []).flatMap((alias) =>
        aliasSpans(normalizedQuestion, alias)
      );
      const onlyBySearchName = ownSpans.length === 0 && searchSpans.length > 0;
      return {
        checklist,
        spans:
          onlyBySearchName && oppositeAction(question, checklist)
            ? []
            : [...ownSpans, ...searchSpans],
      };
    })
    .filter((match) => match.spans.length > 0);

  // Longer names win: "위내시경점막하박리술" must not also open "위내시경".
  const containedByLonger = (span, self) =>
    matches.some(
      (other) =>
        other !== self &&
        other.spans.some(
          ([start, end]) =>
            start <= span[0] &&
            end >= span[1] &&
            end - start > span[1] - span[0]
        )
    );

  return matches
    .filter(
      (match) => !match.spans.every((span) => containedByLonger(span, match))
    )
    .map((match) => match.checklist);
}
