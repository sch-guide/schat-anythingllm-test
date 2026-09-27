function normalizedRelativeDocpath(value) {
  if (typeof value !== "string") return null;
  const normalized = value.trim().replace(/\\/g, "/");
  const parts = normalized.split("/");
  if (
    normalized.startsWith("/") ||
    /^[a-z]:\//i.test(normalized) ||
    parts.length !== 2 ||
    parts.some((part) => !part || part === "." || part === "..")
  )
    return null;
  return normalized;
}

const UPLOAD_LOOKUP_BATCH_SIZE = 200;

function buildUploadSuccessResponse(documents = []) {
  const docpaths = new Set();
  for (const document of documents) {
    const docpath = normalizedRelativeDocpath(document?.location);
    if (docpath) docpaths.add(docpath);
  }
  return { success: true, error: null, docpaths: [...docpaths] };
}

function validateUploadLookupDocpaths(values) {
  if (!Array.isArray(values)) return { ok: false, code: 400, docpaths: [] };
  if (values.length > UPLOAD_LOOKUP_BATCH_SIZE)
    return { ok: false, code: 413, docpaths: [] };

  const docpaths = new Set();
  for (const value of values) {
    const docpath = normalizedRelativeDocpath(value);
    if (docpath) docpaths.add(docpath);
  }
  return { ok: true, code: 200, docpaths: [...docpaths] };
}

/**
 * Whitelist the small set of fields needed to render and select a newly
 * uploaded picker row. Processed JSON may also contain source text, stable
 * document identifiers and image metadata; none of those belong in this
 * response. The URL is deliberately reduced to the storage filename so a
 * `file://` source path never reaches the browser.
 */
function toPublicUploadPickerDocument(document = {}) {
  const docpath = normalizedRelativeDocpath(document.docpath);
  if (!docpath || typeof document.id !== "string" || !document.id.trim())
    return null;

  const name = docpath.split("/")[1];
  if (typeof document.name !== "string" || document.name !== name) return null;

  return {
    id: document.id,
    name,
    type: "file",
    title:
      typeof document.title === "string" && document.title.trim()
        ? document.title
        : name,
    published:
      typeof document.published === "string" ? document.published : null,
    url: name,
    cached: document.cached === true,
    canWatch: document.canWatch === true,
    docpath,
  };
}

module.exports = {
  UPLOAD_LOOKUP_BATCH_SIZE,
  buildUploadSuccessResponse,
  validateUploadLookupDocpaths,
  toPublicUploadPickerDocument,
};
