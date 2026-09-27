const REFUSAL_TEXT = "근거를 안전하게 확인할 수 없어 답변하지 않습니다.";
const PLACEHOLDER_TEXT = /^(unknown|no description found\.?|n\/a|null|undefined)$/i;
const DOCUMENT_METADATA =
  /<document_metadata\b[^>]*>[\s\S]*?(?:<\/document_metadata>|$)/gi;
const SVG_BLOCK = /<svg\b[^>]*>[\s\S]*?(?:<\/svg>|$)/gi;
const TECHNICAL_TAG = /<\/?(?:document_metadata|svg)\b[^>]*>/gi;
const SVG_PLACEHOLDER_LINE = /^\s*(?:\[?svg\]?|svg placeholder)\s*$/i;
const INTERNAL_SOURCE_IDENTIFIER =
  /\b(?:su\d{3,}|source[_ ]?unit(?:[_ ]?id)?|chunk[_ ]?id|document[_ ]?id)\b/gi;
const INTERNAL_PATH =
  /(?:file:\/\/|[a-z]:\\|\/(?:app|home|storage|tmp|workspace)\/)/i;
const MAX_SOURCE_EXCERPT_LENGTH = 1200;
const MAX_SOURCE_EXCERPT_LOOKAHEAD = 50;

function sanitizeDisplayText(value = "") {
  if (typeof value !== "string") return "";
  const cleaned = value.normalize("NFKC").replace(/\uFFFD+/g, "").trim();
  return !cleaned || PLACEHOLDER_TEXT.test(cleaned) ? "" : cleaned;
}

function sanitizeDocumentName(value = "") {
  const cleaned = sanitizeDisplayText(value).replace(/^file:\/\//i, "");
  return cleaned.split(/[\\/]/).filter(Boolean).at(-1) || "";
}

function normalizePage(value = null) {
  if (Number.isInteger(value) && value > 0) return value;
  if (typeof value === "string" && /^\d+$/.test(value.trim())) {
    const page = Number(value);
    return page > 0 ? page : null;
  }
  return null;
}

function sanitizeEmployeeAnswer(value = "") {
  if (typeof value !== "string") return "";
  return value
    .normalize("NFKC")
    .replace(DOCUMENT_METADATA, " ")
    .replace(SVG_BLOCK, " ")
    .replace(TECHNICAL_TAG, " ")
    .split(/\r?\n/)
    .filter((line) => !SVG_PLACEHOLDER_LINE.test(line))
    .join("\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function truncateSourceExcerpt(value = "") {
  if (value.length <= MAX_SOURCE_EXCERPT_LENGTH) return value;

  const beforeLimit = value.slice(0, MAX_SOURCE_EXCERPT_LENGTH + 1);
  const paragraphBoundary = beforeLimit.lastIndexOf("\n\n");
  const sentenceBoundary = Math.max(
    beforeLimit.lastIndexOf(". "),
    beforeLimit.lastIndexOf("! "),
    beforeLimit.lastIndexOf("? "),
    beforeLimit.lastIndexOf("。")
  );
  let boundary = Math.max(paragraphBoundary, sentenceBoundary);
  if (boundary >= Math.floor(MAX_SOURCE_EXCERPT_LENGTH / 2)) {
    if (/^[.!?]$/.test(value[boundary])) boundary += 1;
    return `${value.slice(0, boundary).trimEnd()} …`;
  }

  const lookahead = value.slice(
    MAX_SOURCE_EXCERPT_LENGTH,
    MAX_SOURCE_EXCERPT_LENGTH + MAX_SOURCE_EXCERPT_LOOKAHEAD
  );
  const nextBoundary = lookahead.search(/[.!?。](?:\s|$)/);
  if (nextBoundary >= 0) {
    return `${value
      .slice(0, MAX_SOURCE_EXCERPT_LENGTH + nextBoundary + 1)
      .trimEnd()} …`;
  }

  // A single unbounded sentence cannot be shortened without changing its meaning.
  // Keep the legacy metadata-only behavior instead of exposing a broken fragment.
  return "";
}

function sanitizeSourceExcerpt(value = "") {
  const cleaned = sanitizeEmployeeAnswer(value)
    .split(/\r?\n/)
    .filter((line) => !INTERNAL_PATH.test(line))
    .join("\n")
    .replace(INTERNAL_SOURCE_IDENTIFIER, " ")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return truncateSourceExcerpt(cleaned);
}

function answerParagraphs(value = "") {
  return sanitizeEmployeeAnswer(value)
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
}

function withoutPresentationPrefix(paragraph = "") {
  return paragraph
    .replace(/^\s*\d+[.)]\s+/, "")
    .replace(/^\s*[-*•]\s+(?:\[[ xX]\]\s+)?/, "")
    .trim();
}

function formatNumberedStep(paragraph = "", index = 0) {
  const value = withoutPresentationPrefix(paragraph);
  const labeled = value.match(/^([^:\n]{2,40}):\s+([\s\S]+)$/);
  if (!labeled) return `${index + 1}. ${value}`;
  return `${index + 1}. **${labeled[1].trim()}**\n   ${labeled[2].trim()}`;
}

function formatValidatedAnswer(value = "", answerStyle = "plain") {
  const paragraphs = answerParagraphs(value);
  if (paragraphs.length === 0) return "";

  if (answerStyle === "list" || answerStyle === "comparison") {
    return paragraphs
      .map((paragraph) => `- ${withoutPresentationPrefix(paragraph)}`)
      .join("\n");
  }
  if (answerStyle === "numbered_steps") {
    return paragraphs.map(formatNumberedStep).join("\n");
  }
  if (answerStyle === "checklist") {
    return paragraphs
      .map((paragraph) => `- [ ] ${withoutPresentationPrefix(paragraph)}`)
      .join("\n");
  }
  if (answerStyle === "explanation" && paragraphs.length > 1) {
    return [
      "**핵심 답변**",
      paragraphs[0],
      "**핵심 설명**",
      paragraphs.slice(1).join("\n\n"),
    ].join("\n\n");
  }
  return paragraphs.join("\n\n");
}

function normalizeDisplaySources(sources = []) {
  if (!Array.isArray(sources)) return [];
  return sources.map((source) => {
    const documentName =
      sanitizeDocumentName(source.document_name) || "등록된 지침서";
    const page = normalizePage(source.page);
    const section = sanitizeDisplayText(source.section);
    const excerpt = sanitizeSourceExcerpt(source.exact_text);
    const citationParts = [
      documentName,
      page === null ? null : `p.${page}`,
      section || null,
    ].filter(Boolean);
    return {
      title: citationParts.join(" · "),
      documentName,
      document_name: documentName,
      page,
      section,
      excerpt,
      text: excerpt,
      chunkSource: "",
    };
  });
}

function finalizeSafetyDecision({ prepared, validation, errorCode = null }) {
  const pass =
    validation?.decision === "PASS" &&
    validation?.retry_count === 0 &&
    validation?.display_output?.kind === "candidate" &&
    typeof validation?.display_output?.text === "string";
  if (pass) {
    const safeCandidate = formatValidatedAnswer(
      validation.display_output.text,
      prepared?.answer_style
    );
    if (!safeCandidate) {
      return {
        text: REFUSAL_TEXT,
        sources: [],
        safety: {
          passed: false,
          usedFallback: false,
          errorCode: "empty_safe_candidate",
          retryCount: 0,
        },
      };
    }
    return {
      text: safeCandidate,
      sources: normalizeDisplaySources(validation.display_output.sources),
      safety: { passed: true, usedFallback: false, errorCode: null, retryCount: 0 },
    };
  }

  const fallback = prepared?.fallback;
  const safeFallback = sanitizeEmployeeAnswer(fallback?.text);
  const hasFallback = Boolean(
    safeFallback
  );
  return {
    text: hasFallback ? safeFallback : REFUSAL_TEXT,
    sources: hasFallback ? normalizeDisplaySources(fallback.sources) : [],
    safety: {
      passed: false,
      usedFallback: hasFallback,
      errorCode: validation?.error_code || errorCode || "safety_evaluator_failed",
      retryCount: 0,
    },
  };
}

module.exports = {
  finalizeSafetyDecision,
  formatValidatedAnswer,
  normalizeDisplaySources,
  normalizePage,
  sanitizeDisplayText,
  sanitizeEmployeeAnswer,
  sanitizeSourceExcerpt,
  REFUSAL_TEXT,
};
