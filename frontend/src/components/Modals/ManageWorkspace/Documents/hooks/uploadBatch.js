function validDocpath(value) {
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

function publicUploadFile(document, docpath) {
  if (!document || typeof document.id !== "string" || !document.id.trim())
    return null;
  const name = docpath.split("/")[1];
  if (document.name !== name) return null;
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

export function mergeUploadCompletion(pending = [], completion = {}) {
  const merged = new Set(pending.map(validDocpath).filter(Boolean));
  if (completion?.success !== true) return [...merged];
  for (const docpath of completion.docpaths ?? []) {
    const normalized = validDocpath(docpath);
    if (normalized) merged.add(normalized);
  }
  return [...merged];
}

export function uploadedFolderNames(docpaths = []) {
  const folders = new Set();
  for (const docpath of docpaths) {
    const normalized = validDocpath(docpath);
    if (normalized) folders.add(normalized.split("/")[0]);
  }
  return [...folders];
}

export function uploadedFileIdsForFolder({
  folderName,
  files = [],
  uploadedDocpaths = [],
  embeddedDocpaths = [],
} = {}) {
  const uploaded = new Set(uploadedDocpaths.map(validDocpath).filter(Boolean));
  const embedded = new Set(embeddedDocpaths.map(validDocpath).filter(Boolean));
  return files
    .filter((file) => {
      const docpath = validDocpath(`${folderName}/${file?.name ?? ""}`);
      return docpath && uploaded.has(docpath) && !embedded.has(docpath);
    })
    .map((file) => file.id);
}

/**
 * Resolve only this upload's storage paths. Requests are deliberately bounded
 * and sequential so a large upload never turns into an unbounded folder scan
 * or a burst of simultaneous JSON parsing on the server.
 */
export async function fetchUploadedBatchRecords({
  uploadedDocpaths = [],
  embeddedDocpaths = [],
  fetchByDocpaths,
} = {}) {
  if (typeof fetchByDocpaths !== "function") return [];

  const requested = mergeUploadCompletion([], {
    success: true,
    docpaths: uploadedDocpaths,
  });
  const requestedSet = new Set(requested);
  const embedded = new Set(
    embeddedDocpaths.map(validDocpath).filter(Boolean)
  );
  const records = [];
  const seen = new Set();

  for (
    let offset = 0;
    offset < requested.length;
    offset += UPLOAD_LOOKUP_BATCH_SIZE
  ) {
    const batch = requested.slice(offset, offset + UPLOAD_LOOKUP_BATCH_SIZE);
    const documents = (await fetchByDocpaths(batch)) ?? [];
    for (const document of documents) {
      const docpath = validDocpath(document?.docpath);
      if (
        !docpath ||
        !requestedSet.has(docpath) ||
        embedded.has(docpath) ||
        seen.has(docpath)
      )
        continue;
      const file = publicUploadFile(document, docpath);
      if (!file) continue;
      seen.add(docpath);
      records.push({
        docpath,
        folderName: docpath.split("/")[0],
        file,
      });
    }
  }

  const missing = requested.some(
    (docpath) => !embedded.has(docpath) && !seen.has(docpath)
  );
  if (missing) throw new Error("Uploaded document lookup incomplete.");

  return records;
}

export async function runUploadCompletionSync({
  docpaths = [],
  onUploadComplete,
} = {}) {
  if (typeof onUploadComplete !== "function") return { ok: true };
  try {
    await onUploadComplete(docpaths);
    return { ok: true };
  } catch {
    return { ok: false };
  }
}

export function workspaceDocpathsForRefresh(
  currentWorkspace,
  fallbackDocpaths = []
) {
  if (!currentWorkspace) return [...fallbackDocpaths];
  return (currentWorkspace.documents ?? [])
    .map((document) => validDocpath(document?.docpath))
    .filter(Boolean);
}

export function resolveUploadedSelectionRecords({
  records = [],
  selectedIds = new Set(),
  seenIds = new Set(),
  embeddedDocpaths = new Set(),
} = {}) {
  const resolved = [];
  const seen = new Set(seenIds);
  for (const record of records) {
    const id = record?.file?.id;
    const docpath = validDocpath(
      `${record?.folderName ?? ""}/${record?.file?.name ?? ""}`
    );
    if (
      !id ||
      !docpath ||
      !selectedIds.has(id) ||
      seen.has(id) ||
      embeddedDocpaths.has(docpath)
    )
      continue;
    seen.add(id);
    resolved.push({ ...record.file, folderName: record.folderName });
  }
  return resolved;
}
