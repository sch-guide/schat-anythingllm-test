const SCHAT_CHUNK_SIZE = 900;
const SCHAT_CHUNK_OVERLAP = 120;
const SCHAT_CHUNK_POLICY_VERSION = "schat-chroma-900-120-section-v2";
const NON_EMPLOYEE_SCOPES = new Set(["evaluation", "test", "synthetic"]);

function normalizedUsageScope(metadata = {}) {
  return String(metadata.usage_scope || metadata.document_class || "employee")
    .normalize("NFKC")
    .trim()
    .toLowerCase();
}

function isEmployeeSearchDocument(metadata = {}) {
  return !NON_EMPLOYEE_SCOPES.has(normalizedUsageScope(metadata));
}

function cleanSection(value = "") {
  if (typeof value !== "string") return "";
  const cleaned = value.normalize("NFKC").replace(/\uFFFD+/g, "").trim();
  return /^(?:unknown|n\/a|null|undefined)$/i.test(cleaned) ? "" : cleaned;
}

function explicitSectionFromText(text = "", existingSection = "") {
  const preserved = cleanSection(existingSection);
  if (preserved) return preserved;
  if (typeof text !== "string") return "";

  const headings = text
    .split(/\r?\n/)
    .slice(0, 12)
    .map((line) => line.trim())
    .filter((line) => line.length >= 3 && line.length <= 90)
    .map((line) => {
      const markdown = line.match(/^#{1,6}\s+(.+)$/);
      if (markdown) return markdown[1].trim();
      const numbered = line.match(/^\d+(?:\.\d+)*[.)]?\s+(.+)$/);
      if (numbered) return numbered[1].trim();
      const plainHeading =
        !/[.!?。！？:：]$/.test(line) &&
        /(?:정의|목적|종류|절차|대상|범위|주의사항|준비사항|확인사항|관리|방법|기준)$/.test(
          line
        );
      return plainHeading ? line : "";
    })
    .filter(Boolean);
  return cleanSection(headings.at(-1) || "");
}

function searchableChunkMetadata(metadata = {}, chunkText = "") {
  const section = explicitSectionFromText(chunkText, metadata.section);
  return {
    metadata: { ...metadata, ...(section ? { section } : {}) },
    // Clinical text and administrative metadata must not be combined. Chroma
    // stores both separately, so injecting an XML-like header only harms
    // retrieval and can leak internal fields into employee answers.
    chunkHeaderMeta: null,
  };
}

module.exports = {
  SCHAT_CHUNK_SIZE,
  SCHAT_CHUNK_OVERLAP,
  SCHAT_CHUNK_POLICY_VERSION,
  explicitSectionFromText,
  isEmployeeSearchDocument,
  normalizedUsageScope,
  searchableChunkMetadata,
};
