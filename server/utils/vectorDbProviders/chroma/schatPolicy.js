const SCHAT_CHUNK_SIZE = 900;
const SCHAT_CHUNK_OVERLAP = 120;
const SCHAT_CHUNK_POLICY_VERSION = "schat-chroma-900-120-v1";
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

function searchableChunkMetadata(metadata = {}) {
  return {
    metadata: { ...metadata },
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
  isEmployeeSearchDocument,
  normalizedUsageScope,
  searchableChunkMetadata,
};
