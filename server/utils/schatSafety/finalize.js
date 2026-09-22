const REFUSAL_TEXT = "근거를 안전하게 확인할 수 없어 답변하지 않습니다.";
const PLACEHOLDER_TEXT = /^(unknown|no description found\.?|n\/a|null|undefined)$/i;

function sanitizeDisplayText(value = "") {
  if (typeof value !== "string") return "";
  const cleaned = value.normalize("NFKC").replace(/\uFFFD+/g, "").trim();
  return !cleaned || PLACEHOLDER_TEXT.test(cleaned) ? "" : cleaned;
}

function normalizePage(value = null) {
  if (Number.isInteger(value) && value > 0) return value;
  if (typeof value === "string" && /^\d+$/.test(value.trim())) {
    const page = Number(value);
    return page > 0 ? page : null;
  }
  return null;
}

function normalizeDisplaySources(sources = []) {
  if (!Array.isArray(sources)) return [];
  return sources.map((source) => {
    const documentName =
      sanitizeDisplayText(source.document_name) || "등록된 지침서";
    const page = normalizePage(source.page);
    const section = sanitizeDisplayText(source.section);
    const citationParts = [
      documentName,
      page === null ? null : `p.${page}`,
      section || null,
    ].filter(Boolean);
    return {
      title: citationParts.join(" · "),
      document_name: sanitizeDisplayText(source.document_name),
      page,
      section,
      text: "",
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
    return {
      text: validation.display_output.text,
      sources: normalizeDisplaySources(validation.display_output.sources),
      safety: { passed: true, usedFallback: false, errorCode: null, retryCount: 0 },
    };
  }

  const fallback = prepared?.fallback;
  const hasFallback = Boolean(
    typeof fallback?.text === "string" && fallback.text.trim()
  );
  return {
    text: hasFallback ? fallback.text : REFUSAL_TEXT,
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
  normalizeDisplaySources,
  normalizePage,
  sanitizeDisplayText,
  REFUSAL_TEXT,
};
