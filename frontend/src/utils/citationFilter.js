const GENERIC_TERMS = new Set([
  "검사",
  "준비",
  "환자",
  "간호",
  "확인",
  "방법",
  "설명",
  "알려줘",
  "알려주세요",
  "관련",
  "시행",
  "시행한다",
  "합니다",
  "있습니다",
  "위해",
  "대한",
  "경우",
  "care",
  "check",
  "procedure",
]);

function normalize(value = "") {
  return String(value)
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[^가-힣a-z0-9]+/g, " ")
    .trim();
}

function compact(value = "") {
  return normalize(value).replace(/\s+/g, "");
}

function meaningfulTokens(value = "") {
  return normalize(value)
    .split(/\s+/)
    .filter((token) => token.length >= 2 && !GENERIC_TERMS.has(token));
}

function tokenWindows(tokens, size = 3) {
  const windows = new Set();
  for (let index = 0; index <= tokens.length - size; index += 1)
    windows.add(tokens.slice(index, index + size).join("\u001f"));
  return windows;
}

function sourceText(source = {}) {
  return [source.excerpt, source.text, source.section, source.title]
    .filter((value) => typeof value === "string")
    .join("\n");
}

function hasAlias(source, aliases = []) {
  const haystack = compact(sourceText(source));
  return aliases.some((alias) => {
    const needle = compact(alias);
    return needle.length >= 3 && haystack.includes(needle);
  });
}

function hasQuestionFocus(question, source) {
  const questionTokens = [...new Set(meaningfulTokens(question))];
  if (questionTokens.length === 0) return false;
  const sourceTokens = new Set(meaningfulTokens(sourceText(source)));
  const matches = questionTokens.filter((token) => sourceTokens.has(token));
  return matches.length >= Math.min(2, questionTokens.length);
}

// Same picture-request words as the server (schatBm25.isImageRequest).
const IMAGE_REQUEST_PATTERN = /사진|그림|이미지|도식|도표|그래프/u;
const IMAGE_REQUEST_WORD = /^(?:사진|그림|이미지|도식|도표|그래프|보여)/u;

/**
 * Picture questions only: a source that carries a guideline picture stays
 * visible when it mentions at least one subject word of the question, even
 * if the answer text does not repeat the picture description.
 */
function isRequestedImageSource(question, source) {
  if (!IMAGE_REQUEST_PATTERN.test(String(question).normalize("NFKC")))
    return false;
  if (!Array.isArray(source?.relatedImages) || !source.relatedImages.length)
    return false;
  const haystack = compact(sourceText(source));
  return meaningfulTokens(question)
    .filter((token) => !IMAGE_REQUEST_WORD.test(token))
    .some((token) => haystack.includes(token));
}

function answerEvidenceStrength(answer, source) {
  const answerTokens = meaningfulTokens(answer);
  const sourceTokens = meaningfulTokens(sourceText(source));
  const answerWindows = tokenWindows(answerTokens);
  const sourceWindows = tokenWindows(sourceTokens);
  const phraseMatches = [...sourceWindows].filter((window) =>
    answerWindows.has(window)
  ).length;
  const answerSet = new Set(answerTokens);
  const tokenMatches = new Set(
    sourceTokens.filter((token) => answerSet.has(token))
  ).size;
  return { phraseMatches, tokenMatches };
}

/**
 * Filters only the employee-facing Citation list. Stored sources and the
 * evidence supplied to Gemini remain untouched. If deterministic matching is
 * not confident, returning the original array prevents evidence disappearing.
 */
export function filterDirectCitationSources({
  question = "",
  answer = "",
  sources = [],
  aliases = [],
} = {}) {
  if (!Array.isArray(sources) || sources.length === 0) return [];
  if (!question.trim() || !answer.trim()) return sources;

  const aliasFocusedSources = aliases.length
    ? sources.filter((source) => hasAlias(source, aliases))
    : [];
  const candidates =
    aliasFocusedSources.length > 0 ? aliasFocusedSources : sources;

  const filtered = candidates.filter((source) => {
    const focused =
      hasAlias(source, aliases) || hasQuestionFocus(question, source);
    const { phraseMatches, tokenMatches } = answerEvidenceStrength(
      answer,
      source
    );
    return (
      (focused && (phraseMatches >= 1 || tokenMatches >= 2)) ||
      phraseMatches >= 1 ||
      isRequestedImageSource(question, source)
    );
  });

  if (filtered.length > 0) return filtered;
  if (aliasFocusedSources.length > 0) return aliasFocusedSources;
  return sources;
}
