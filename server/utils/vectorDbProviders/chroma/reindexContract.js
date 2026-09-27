function assertApprovedReindexScope(
  records = [],
  { expectedDocuments = 100, expectedLogicalDocuments = 1 } = {}
) {
  const logicalDocumentIds = new Set(
    records.map((record) => String(record.document_id || "").trim())
  );
  const uniquePages = new Set(
    records.map(
      (record) =>
        `${String(record.document_id || "").trim()}::${String(record.page).trim()}`
    )
  );
  const valid =
    records.length === expectedDocuments &&
    uniquePages.size === records.length &&
    logicalDocumentIds.size === expectedLogicalDocuments &&
    !logicalDocumentIds.has("") &&
    records.every(
      (record) =>
        record.page !== null &&
        record.page !== undefined &&
        String(record.page).trim() !== ""
    );
  if (!valid) throw new Error("Approved reindex scope does not match.");

  return {
    recordCount: records.length,
    logicalDocumentCount: logicalDocumentIds.size,
  };
}

function buildReindexCollectionNames(live, runId) {
  const base = String(live || "").trim();
  const suffix = String(runId || "").trim();
  if (!base || !suffix) throw new Error("Collection name and run ID required.");
  return {
    live: base,
    staging: `${base}-reindex-${suffix}`,
    previous: `${base}-before-${suffix}`,
  };
}

function summarizeReindexMetadata(records = []) {
  return {
    vectorCount: records.length,
    pageMetadataCount: records.filter(
      ({ metadata = {} }) =>
        metadata.page !== null &&
        metadata.page !== undefined &&
        String(metadata.page).trim() !== ""
    ).length,
    sectionMetadataCount: records.filter(
      ({ metadata = {} }) => Boolean(String(metadata.section || "").trim())
    ).length,
  };
}

function sanitizeChromaMetadata(metadata = {}) {
  return Object.fromEntries(
    Object.entries(metadata).filter(([, value]) => {
      if (typeof value === "string") return value.trim().length > 0;
      return typeof value === "number" || typeof value === "boolean";
    })
  );
}

function imageStats(records = []) {
  let imageCount = 0;
  let imageDescriptionCount = 0;
  for (const record of records) {
    const images = Array.isArray(record.pdf_images) ? record.pdf_images : [];
    imageCount += images.length;
    imageDescriptionCount += images.filter(
      (image) =>
        typeof image?.description === "string" && image.description.trim()
    ).length;
  }
  return { imageCount, imageDescriptionCount };
}

/**
 * Select one complete processed-PDF group without relying on a filename alone.
 * Filename narrows the candidates; stable document_id and a complete, unique
 * 1..N page set prove that a group represents one original upload.
 */
function selectPreferredCompleteDocumentGroup(
  records = [],
  { title = "", expectedPages = 0, requiredPages = [] } = {}
) {
  const groups = new Map();
  for (const record of records) {
    if (String(record?.title || "") !== title) continue;
    const documentId = String(record?.document_id || "").trim();
    if (!documentId) continue;
    if (!groups.has(documentId)) groups.set(documentId, []);
    groups.get(documentId).push(record);
  }

  const expectedPageSet = new Set(
    Array.from({ length: expectedPages }, (_, index) => index + 1)
  );
  const candidates = [];
  for (const [documentId, groupRecords] of groups) {
    const pages = groupRecords.map(({ page }) => Number(page));
    const pageSet = new Set(pages);
    const complete =
      Number.isInteger(expectedPages) &&
      expectedPages > 0 &&
      groupRecords.length === expectedPages &&
      pageSet.size === expectedPages &&
      [...expectedPageSet].every((page) => pageSet.has(page)) &&
      requiredPages.every((page) => pageSet.has(Number(page)));
    if (!complete) continue;

    const stats = imageStats(groupRecords);
    candidates.push({
      documentId,
      records: [...groupRecords].sort((left, right) => left.page - right.page),
      ...stats,
      latestMtimeMs: Math.max(
        0,
        ...groupRecords.map(({ mtimeMs }) => Number(mtimeMs) || 0)
      ),
    });
  }

  candidates.sort(
    (left, right) =>
      right.imageDescriptionCount - left.imageDescriptionCount ||
      right.imageCount - left.imageCount ||
      right.latestMtimeMs - left.latestMtimeMs ||
      left.documentId.localeCompare(right.documentId)
  );
  if (!candidates.length)
    throw new Error("No complete source document group matched the repair scope.");
  return candidates[0];
}

function buildWorkspaceRepairPlan(
  localRecords = [],
  workspaceRecords = [],
  options = {}
) {
  const canonical = selectPreferredCompleteDocumentGroup(localRecords, options);
  const targetTitle = String(options.title || "");
  const canonicalPaths = new Set(
    canonical.records.map(({ docpath }) => String(docpath || ""))
  );
  const targetRecords = workspaceRecords.filter(
    ({ title }) => String(title || "") === targetTitle
  );
  const canonicalExistingRecords = targetRecords.filter(
    ({ document_id }) => String(document_id || "") === canonical.documentId
  );
  if (
    canonicalExistingRecords.some(
      ({ docpath }) => !canonicalPaths.has(String(docpath || ""))
    )
  )
    throw new Error("Workspace canonical records do not match local documents.");

  const existingPaths = new Set(
    canonicalExistingRecords.map(({ docpath }) => String(docpath || ""))
  );
  const missingCanonicalRecords = canonical.records.filter(
    ({ docpath }) => !existingPaths.has(String(docpath || ""))
  );
  const duplicateTargetRecords = targetRecords.filter(
    ({ document_id }) => String(document_id || "") !== canonical.documentId
  );
  const preservedRecords = workspaceRecords.filter(
    ({ title }) => String(title || "") !== targetTitle
  );

  return {
    canonical,
    canonicalExistingRecords,
    duplicateTargetRecords,
    missingCanonicalRecords,
    preservedRecords,
    expectedFinalDocuments: preservedRecords.length + canonical.records.length,
  };
}

module.exports = {
  assertApprovedReindexScope,
  buildWorkspaceRepairPlan,
  buildReindexCollectionNames,
  sanitizeChromaMetadata,
  selectPreferredCompleteDocumentGroup,
  summarizeReindexMetadata,
};
