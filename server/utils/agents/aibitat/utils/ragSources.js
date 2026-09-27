const {
  normalizePage,
  sanitizeDisplayText,
  sanitizeSourceExcerpt,
} = require("../../../schatSafety/finalize");
const { pdfRefForDocumentId } = require("../../../originalDocuments");

const IMAGE_KEY_PATTERN = /^[a-f0-9]{64}$/;
const DECORATIVE_IMAGE =
  /(?:로고|장식|워터마크|엠블럼|문양|logo|decorative|decoration|watermark|emblem)/i;

const CLOSED_BOOK_NO_EVIDENCE =
  "등록된 병원 문서에서 근거를 찾지 못했으며 일반 지식으로 보완하지 말 것.";

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

function matchesQuestionFocus(question = "", description = "") {
  const questionIdentifiers = uppercaseIdentifiers(question);
  if (questionIdentifiers.length === 0) return true;

  const descriptionIdentifiers = uppercaseIdentifiers(description);
  if (descriptionIdentifiers.length === 0) return false;
  return descriptionIdentifiers.some((identifier) =>
    questionIdentifiers.includes(identifier)
  );
}

function buildRagContext(sources = []) {
  const sourceTexts = Array.isArray(sources)
    ? sources
        .map((source) =>
          typeof source?.text === "string" ? source.text.trim() : ""
        )
        .filter(Boolean)
    : [];
  if (sourceTexts.length === 0) return CLOSED_BOOK_NO_EVIDENCE;
  return `등록된 병원 문서에서 검색한 근거:\n\n${sourceTexts.join("\n\n")}`;
}

function publicDocumentName(source = {}) {
  const value = sanitizeDisplayText(
    source.document_name || source.documentName || source.title || ""
  ).replace(/^file:\/\//i, "");
  return value.split(/[\\/]/).filter(Boolean).at(-1) || "등록된 지침서";
}

function ragSourceIdentity(source = {}) {
  const documentId = String(source.document_id || source.documentId || "");
  const vectorId = String(source.id || source.chunk_id || "");
  if (vectorId) return `${documentId}:${vectorId}`;

  const documentName = publicDocumentName(source);
  const page = normalizePage(source.page) || "";
  const section = sanitizeDisplayText(source.section);
  const excerpt = sanitizeSourceExcerpt(source.text || source.excerpt || "");
  return [documentName, page, section, excerpt].join("\u001f");
}

function directRelatedImages(source, publicFields, { question = "" } = {}) {
  const imageKey = String(source.image_key || "");
  const description = sanitizeSourceExcerpt(
    source.image_description || source.text || source.excerpt || ""
  );
  if (
    !IMAGE_KEY_PATTERN.test(imageKey) ||
    !description ||
    DECORATIVE_IMAGE.test(description) ||
    !matchesQuestionFocus(question, description)
  )
    return [];

  return [
    {
      imageKey,
      documentName: publicFields.documentName,
      page: publicFields.page,
      section: publicFields.section,
      matchType:
        source.content_type === "image_description"
          ? "image_description"
          : "source_unit",
    },
  ];
}

function buildPublicRagSource(source = {}, { question = "" } = {}) {
  const documentName = publicDocumentName(source);
  const page = normalizePage(source.page);
  const section = sanitizeDisplayText(source.section);
  // Chroma puts the exact context returned for this source on source.text.
  // Do not pair this with contextTexts by array index: source.text remains
  // attached to its own vector metadata throughout retrieval.
  const excerpt = sanitizeSourceExcerpt(source.text || source.excerpt || "");
  const title = [
    documentName,
    page === null ? null : `p.${page}`,
    section || null,
  ]
    .filter(Boolean)
    .join(" · ");
  const publicFields = {
    title,
    documentName,
    document_name: documentName,
    page,
    section,
    excerpt,
    text: excerpt,
  };
  const documentId = String(source.document_id || source.documentId || "").trim();
  const pdfRef =
    documentId && /\.pdf$/i.test(documentName)
      ? pdfRefForDocumentId(documentId)
      : null;

  return {
    ...publicFields,
    ...(pdfRef ? { pdfRef } : {}),
    relatedImages: directRelatedImages(source, publicFields, {
      question,
    }).slice(0, 3),
  };
}

module.exports = {
  buildRagContext,
  buildPublicRagSource,
  ragSourceIdentity,
};
