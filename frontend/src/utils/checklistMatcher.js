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

export function matchChecklists(question = "", checklists = []) {
  const normalizedQuestion = normalizeChecklistQuestion(question);
  if (!normalizedQuestion) return [];

  const matches = (Array.isArray(checklists) ? checklists : [])
    .filter((checklist) => checklist?.active !== false)
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
