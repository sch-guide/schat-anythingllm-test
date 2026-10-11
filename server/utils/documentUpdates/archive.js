function isArchivedDocument(document) {
  try {
    const metadata = typeof document?.metadata === "string"
      ? JSON.parse(document.metadata) : document?.metadata;
    return metadata?.schat_document_update_archived === true;
  } catch { return false; }
}

function canonicalDocumentPath(value) {
  if (typeof value !== "string") throw new Error("INVALID_DOCUMENT_PATH");
  const normalized = value.trim().replace(/\\/g, "/");
  const parts = normalized.split("/");
  if (!normalized || normalized.startsWith("/") || /[:\u0000-\u001f]/.test(normalized) || parts.includes(".."))
    throw new Error("INVALID_DOCUMENT_PATH");
  const result = parts.filter((part) => part && part !== ".").join("/");
  if (!result) throw new Error("INVALID_DOCUMENT_PATH");
  return result;
}

module.exports = { isArchivedDocument, canonicalDocumentPath };
