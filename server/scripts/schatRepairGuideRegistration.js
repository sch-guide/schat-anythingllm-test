const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const {
  buildWorkspaceRepairPlan,
  buildReindexCollectionNames,
  sanitizeChromaMetadata,
  selectPreferredCompleteDocumentGroup,
} = require("../utils/vectorDbProviders/chroma/reindexContract");
const {
  buildImageDescriptionChunks,
} = require("../utils/vectorDbProviders/chroma/imageDescriptionChunks");
const {
  SCHAT_CHUNK_OVERLAP,
  SCHAT_CHUNK_POLICY_VERSION,
  SCHAT_CHUNK_SIZE,
  searchableChunkMetadata,
} = require("../utils/vectorDbProviders/chroma/schatPolicy");

const WORKSPACE_SLUG = "schat-2026-09-22";
const TARGET_TITLE = "2026실무지침서 (26.7).pdf";
const EXPECTED_GUIDE_PAGES = 461;
const REQUIRED_PAGES = [
  113, 114, 117, 118, 119, 120, 121, 122, 123, 124, 125, 159, 160, 161,
  162, 163,
];
const EMBEDDING_MODEL = "gemini-embedding-2";
const EMBEDDING_BATCH_SIZE = 4;
const EMBEDDING_BATCH_DELAY_MS = 2000;
const CHROMA_ADD_BATCH_SIZE = 25;
const MAX_RETRIES = 0;
const EXPECTED = Object.freeze({
  initial: Object.freeze({
    workspaceDocuments: 100,
    sqliteVectors: 151,
    chromaVectors: 151,
    preservedDocuments: 82,
    preservedVectors: 91,
    canonicalDocuments: 9,
    canonicalVectors: 46,
    duplicateDocuments: 9,
    duplicateVectors: 14,
    missingCanonicalDocuments: 452,
  }),
  final: Object.freeze({
    workspaceDocuments: 543,
    sqliteVectors: 717,
    chromaVectors: 717,
    preservedDocuments: 82,
    preservedVectors: 91,
    canonicalDocuments: 461,
    canonicalVectors: 626,
    duplicateDocuments: 0,
    duplicateVectors: 0,
    missingCanonicalDocuments: 0,
  }),
  bodyVectors: 563,
  imageDescriptionVectors: 63,
  reusedCanonicalVectors: 46,
  reusedBodyVectors: 14,
  reusedImageDescriptionVectors: 32,
  missingCanonicalVectors: 580,
  missingBodyVectors: 549,
  missingImageDescriptionVectors: 31,
});

function parseArgs(argv = []) {
  let mode = null;
  for (const value of argv) {
    if (value !== "--dry-run" && value !== "--apply")
      throw new Error("unknown_argument");
    const nextMode = value === "--apply" ? "apply" : "dry-run";
    if (mode && mode !== nextMode) throw new Error("conflicting_mode");
    mode = nextMode;
  }
  return { apply: mode === "apply" };
}

function publicErrorCode(error) {
  const code = String(error?.message || "");
  if (code === "unknown_argument" || code === "conflicting_mode")
    return "invalid_arguments";
  if (
    code === "unexpected_repair_scope" ||
    code === "unexpected_source_group_count" ||
    code === "canonical_source_scope_mismatch"
  )
    return "repair_scope_mismatch";
  if (
    code === "vector_db_must_be_chroma" ||
    code === "embedding_engine_must_be_gemini" ||
    code === "embedding_model_scope_mismatch" ||
    code === "chunk_policy_scope_mismatch"
  )
    return "configuration_mismatch";
  if (code === "gemini_embedding_api_key_missing")
    return "embedding_configuration_missing";
  if (
    code === "repair_source_changed_during_staging" ||
    code === "repair_local_source_changed_during_staging"
  )
    return "repair_source_changed";
  if (code === "sqlite_backup_failed" || code === "sqlite_backup_path_invalid")
    return "repair_backup_failed";
  if (code === "repair_database_state_unknown")
    return "repair_database_state_unknown";
  if (code === "repair_database_rollback_incomplete")
    return "repair_database_rollback_incomplete";
  if (code === "repair_collection_recovery_incomplete")
    return "repair_collection_recovery_incomplete";
  if (code === "repair_pre_swap_cleanup_incomplete")
    return "repair_pre_swap_cleanup_incomplete";
  if (PUBLIC_PHASE_ERROR_CODES.has(code)) return code;
  if (
    code === "final_count_verification_failed" ||
    code === "final_vector_scope_verification_failed" ||
    code === "required_pages_missing_after_repair" ||
    code === "database_swap_verification_failed" ||
    code === "accounts_or_chats_changed"
  )
    return "repair_verification_failed";
  return "repair_failed";
}

const PUBLIC_PHASE_ERROR_CODES = new Set([
  "repair_phase_backup_failed",
  "repair_phase_staging_create_failed",
  "repair_phase_preserved_copy_failed",
  "repair_phase_embedding_failed",
  "repair_phase_chroma_add_failed",
  "repair_phase_staging_count_failed",
  "repair_phase_staging_mapping_failed",
  "repair_phase_staging_fingerprint_failed",
  "repair_phase_source_recheck_failed",
  "repair_phase_collection_swap_failed",
  "repair_phase_database_swap_failed",
  "repair_phase_final_verify_failed",
]);

async function runRepairPhase(errorCode, action) {
  try {
    return await action();
  } catch {
    throw new Error(errorCode);
  }
}

function sameCounts(actual, expected) {
  return Object.entries(expected).every(
    ([key, value]) => Number(actual?.[key]) === value
  );
}

function assertKnownRepairScope(stats = {}) {
  if (sameCounts(stats, EXPECTED.final)) return "noop";
  if (sameCounts(stats, EXPECTED.initial)) return "repair";
  throw new Error("unexpected_repair_scope");
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, canonicalize(value[key])])
  );
}

function hashValue(value) {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(canonicalize(value)))
    .digest("hex");
}

function buildRepairStateFingerprint({
  workspaceRecords = [],
  mappings = [],
  liveRows = [],
} = {}) {
  const documents = workspaceRecords
    .map((record) => ({
      id: record.id,
      docId: record.docId,
      filename: record.filename,
      docpath: record.docpath,
      metadataHash: hashValue(record.metadata || ""),
    }))
    .sort((left, right) => String(left.id).localeCompare(String(right.id)));
  const vectorMappings = mappings
    .map((record) => ({
      id: record.id,
      docId: record.docId,
      vectorId: record.vectorId,
    }))
    .sort((left, right) => String(left.id).localeCompare(String(right.id)));
  const vectors = liveRows
    .map((record) => ({
      id: record.id,
      documentHash: hashValue(record.document || ""),
      metadataHash: hashValue(record.metadata || {}),
      embeddingHash: hashValue(record.embedding || []),
    }))
    .sort((left, right) => String(left.id).localeCompare(String(right.id)));
  return hashValue({ documents, vectorMappings, vectors });
}

function buildDatabaseStateFingerprint({ workspaceRecords = [], mappings = [] }) {
  const documents = workspaceRecords
    .map((record) => ({
      docId: record.docId,
      filename: record.filename,
      docpath: record.docpath,
      metadataHash: hashValue(record.metadata || ""),
      pinned: Boolean(record.pinned),
      watched: Boolean(record.watched),
    }))
    .sort((left, right) =>
      `${left.docId}\u0000${left.docpath}`.localeCompare(
        `${right.docId}\u0000${right.docpath}`
      )
    );
  const vectorMappings = mappings
    .map(({ docId, vectorId }) => ({ docId, vectorId }))
    .sort((left, right) =>
      `${left.docId}\u0000${left.vectorId}`.localeCompare(
        `${right.docId}\u0000${right.vectorId}`
      )
    );
  return hashValue({ documents, vectorMappings });
}

function classifyDatabaseFingerprint(
  currentFingerprint,
  { initialFingerprint, desiredFingerprint }
) {
  if (currentFingerprint === initialFingerprint) return "initial";
  if (desiredFingerprint && currentFingerprint === desiredFingerprint)
    return "desired";
  return "unknown";
}

function collectionLayoutForDatabaseState(databaseState) {
  if (databaseState === "initial") return "old-live";
  if (databaseState === "desired") return "new-live";
  throw new Error("repair_database_state_unknown");
}

function buildCollectionFingerprint(rows = []) {
  return hashValue(
    rows
      .map((row) => ({
        id: row.id,
        documentHash: hashValue(row.document || ""),
        metadataHash: hashValue(row.metadata || {}),
        embeddingHash: hashValue(
          normalizeEmbeddingForFingerprint(row.embedding)
        ),
      }))
      .sort((left, right) => String(left.id).localeCompare(String(right.id)))
  );
}

function normalizeEmbeddingForFingerprint(embedding) {
  return validateEmbeddingValues(embedding).map((value) => {
    const normalized = Math.fround(value);
    return Object.is(normalized, -0) ? 0 : normalized;
  });
}

function validateEmbeddingValues(embedding) {
  if (!Array.isArray(embedding) || embedding.length === 0)
    throw new Error("collection_embedding_invalid");
  return embedding.map((value) => {
    if (
      typeof value !== "number" ||
      !Number.isFinite(value) ||
      !Number.isFinite(Math.fround(value))
    )
      throw new Error("collection_embedding_invalid");
    return Object.is(value, -0) ? 0 : value;
  });
}

function summarizeCollectionRoundTrip(expectedRows = [], storedRows = []) {
  const summary = {
    expectedRows: expectedRows.length,
    storedRows: storedRows.length,
    duplicateExpectedRows: 0,
    duplicateStoredRows: 0,
    missingRows: 0,
    unexpectedRows: 0,
    documentMismatches: 0,
    metadataMismatches: 0,
    embeddingInvalidRows: 0,
    embeddingDimensionMismatches: 0,
    embeddingExactMismatches: 0,
    embeddingAllCloseEquivalent: 0,
    embeddingCosineEquivalent: 0,
    embeddingValueMismatches: 0,
  };
  const indexRows = (rows, duplicateKey) => {
    const indexed = new Map();
    for (const row of rows) {
      if (indexed.has(row.id)) summary[duplicateKey] += 1;
      else indexed.set(row.id, row);
    }
    return indexed;
  };
  const expected = indexRows(expectedRows, "duplicateExpectedRows");
  const stored = indexRows(storedRows, "duplicateStoredRows");

  for (const [id, expectedRow] of expected) {
    const storedRow = stored.get(id);
    if (!storedRow) {
      summary.missingRows += 1;
      continue;
    }
    if (String(expectedRow.document || "") !== String(storedRow.document || ""))
      summary.documentMismatches += 1;
    if (hashValue(expectedRow.metadata || {}) !== hashValue(storedRow.metadata || {}))
      summary.metadataMismatches += 1;

    let expectedEmbedding;
    let storedEmbedding;
    try {
      expectedEmbedding = validateEmbeddingValues(expectedRow.embedding);
      storedEmbedding = validateEmbeddingValues(storedRow.embedding);
    } catch {
      summary.embeddingInvalidRows += 1;
      continue;
    }
    if (expectedEmbedding.length !== storedEmbedding.length) {
      summary.embeddingDimensionMismatches += 1;
      continue;
    }
    if (
      expectedEmbedding.every(
        (value, index) => value === storedEmbedding[index]
      )
    )
      continue;

    summary.embeddingExactMismatches += 1;
    let dot = 0;
    let expectedNorm = 0;
    let storedNorm = 0;
    let allClose = true;
    for (let index = 0; index < expectedEmbedding.length; index += 1) {
      const expectedValue = expectedEmbedding[index];
      const storedValue = storedEmbedding[index];
      if (
        Math.abs(storedValue - expectedValue) >
        1e-8 + 1e-5 * Math.abs(expectedValue)
      )
        allClose = false;
      dot += expectedValue * storedValue;
      expectedNorm += expectedValue * expectedValue;
      storedNorm += storedValue * storedValue;
    }
    const denominator = Math.sqrt(expectedNorm * storedNorm);
    const similarity = denominator > 0 ? dot / denominator : -1;
    if (Number.isFinite(similarity) && similarity >= 1 - 1e-6)
      summary.embeddingCosineEquivalent += 1;
    if (allClose) summary.embeddingAllCloseEquivalent += 1;
    else summary.embeddingValueMismatches += 1;
  }
  for (const id of stored.keys()) {
    if (!expected.has(id)) summary.unexpectedRows += 1;
  }
  return summary;
}

function isSafeCollectionRoundTrip(summary = {}) {
  return (
    Number(summary.expectedRows) === Number(summary.storedRows) &&
    Number(summary.duplicateExpectedRows) === 0 &&
    Number(summary.duplicateStoredRows) === 0 &&
    Number(summary.missingRows) === 0 &&
    Number(summary.unexpectedRows) === 0 &&
    Number(summary.documentMismatches) === 0 &&
    Number(summary.metadataMismatches) === 0 &&
    Number(summary.embeddingInvalidRows) === 0 &&
    Number(summary.embeddingDimensionMismatches) === 0 &&
    Number(summary.embeddingValueMismatches) === 0 &&
    Number(summary.embeddingExactMismatches) ===
      Number(summary.embeddingAllCloseEquivalent)
  );
}

function buildCanonicalSourceFingerprint(records = []) {
  return hashValue(
    records
      .map((record) => ({
        docpath: record.docpath,
        sourceHash: hashValue(record.sourceData || record),
      }))
      .sort((left, right) => left.docpath.localeCompare(right.docpath))
  );
}

function vectorSignature({ document = "", metadata = {} } = {}) {
  return hashValue({
    document: String(document || ""),
    document_id: String(metadata?.document_id || ""),
    page: String(metadata?.page ?? ""),
    content_type: String(metadata?.content_type || "body"),
    image_key: String(metadata?.image_key || ""),
  });
}

function buildVectorReusePlan(desired = [], existing = []) {
  const available = new Map();
  for (const row of existing) {
    if (!Array.isArray(row?.embedding) || row.embedding.length === 0) continue;
    const signature = vectorSignature(row);
    if (!available.has(signature)) available.set(signature, []);
    available.get(signature).push(row);
  }

  const reused = [];
  const missing = [];
  for (const row of desired) {
    const matches = available.get(vectorSignature(row));
    const existingRow = matches?.shift();
    if (!existingRow) {
      missing.push(row);
      continue;
    }
    reused.push({
      ...row,
      id: existingRow.id,
      embedding: existingRow.embedding,
    });
  }
  return { reused, missing };
}

function parseMetadata(value) {
  if (value && typeof value === "object") return value;
  if (typeof value !== "string") return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function runId() {
  return new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
}

function storageDirectory() {
  return process.env.STORAGE_DIR
    ? path.resolve(process.env.STORAGE_DIR)
    : path.resolve(__dirname, "../storage");
}

function loadProcessedTargetRecords(storageRoot) {
  const documentsRoot = path.resolve(storageRoot, "documents");
  const folder = path.resolve(documentsRoot, "custom-documents");
  const relative = path.relative(documentsRoot, folder);
  if (
    !relative ||
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  )
    throw new Error("documents_path_invalid");

  const records = [];
  for (const filename of fs.readdirSync(folder)) {
    if (!filename.endsWith(".json")) continue;
    const fullPath = path.resolve(folder, filename);
    let data;
    try {
      data = JSON.parse(fs.readFileSync(fullPath, "utf8"));
    } catch {
      continue;
    }
    if (String(data?.title || "") !== TARGET_TITLE) continue;
    records.push({
      ...data,
      filename,
      docpath: `custom-documents/${filename}`,
      mtimeMs: fs.statSync(fullPath).mtimeMs,
      sourceData: data,
    });
  }
  return records;
}

function enrichWorkspaceRecord(record) {
  const metadata = parseMetadata(record.metadata);
  if (!metadata) throw new Error("workspace_metadata_invalid");
  return {
    ...metadata,
    id: record.id,
    docId: record.docId,
    filename: record.filename,
    docpath: record.docpath,
    workspaceId: record.workspaceId,
    pinned: record.pinned,
    watched: record.watched,
    createdAt: record.createdAt,
    lastUpdatedAt: record.lastUpdatedAt,
    storedMetadata: record.metadata,
    dbRecord: record,
  };
}

function metadataForWorkspace(data = {}) {
  const { pageContent: _pageContent, sourceData: _sourceData, ...metadata } =
    data;
  delete metadata.filename;
  delete metadata.docpath;
  delete metadata.mtimeMs;
  return metadata;
}

async function buildDesiredVectors({
  records,
  docIdsByPath,
  TextSplitter,
  chunkSize,
  chunkOverlap,
}) {
  const desired = [];
  for (const record of records) {
    const data = record.sourceData || record;
    const {
      pageContent = "",
      pdf_images: pdfImages = [],
      sourceData: _sourceData,
      filename: _filename,
      docpath: _docpath,
      mtimeMs: _mtimeMs,
      ...metadata
    } = data;
    const relatedImageKeys = Array.from(
      new Set(
        (Array.isArray(pdfImages) ? pdfImages : [])
          .map((image) => image?.image_key)
          .filter((key) => /^[a-f0-9]{64}$/.test(String(key || "")))
      )
    );
    const bodyMetadata = {
      ...metadata,
      ...(relatedImageKeys.length
        ? { related_image_keys: JSON.stringify(relatedImageKeys) }
        : {}),
    };
    const chunkPolicy = searchableChunkMetadata(bodyMetadata);
    const splitter = new TextSplitter({
      chunkSize,
      chunkOverlap,
      chunkHeaderMeta: chunkPolicy.chunkHeaderMeta,
    });
    const chunks = pageContent ? await splitter.splitText(pageContent) : [];
    const docId = docIdsByPath.get(record.docpath);
    if (!docId) throw new Error("workspace_doc_mapping_missing");

    for (const chunk of chunks) {
      desired.push({
        docId,
        document: chunk,
        metadata: sanitizeChromaMetadata(
          searchableChunkMetadata(bodyMetadata, chunk).metadata
        ),
      });
    }

    const imageChunks = buildImageDescriptionChunks({
      images: pdfImages,
      metadata,
    });
    for (const imageChunk of imageChunks) {
      desired.push({
        docId,
        document: imageChunk.text,
        metadata: sanitizeChromaMetadata(
          searchableChunkMetadata(
            imageChunk.metadata,
            imageChunk.text
          ).metadata
        ),
      });
    }
  }
  return desired;
}

function vectorTypeCounts(rows = []) {
  let body = 0;
  let image = 0;
  for (const row of rows) {
    if (row?.metadata?.content_type === "image_description") image += 1;
    else body += 1;
  }
  return { body, image };
}

function collectionRows(result = {}) {
  return (result.ids || []).map((id, index) => ({
    id,
    document: result.documents?.[index] ?? "",
    metadata: result.metadatas?.[index] ?? {},
    embedding: result.embeddings?.[index] ?? null,
  }));
}

function groupLiveRows(rows, targetDocumentIds, canonicalDocumentId) {
  const preserved = [];
  const canonical = [];
  const duplicate = [];
  for (const row of rows) {
    const documentId = String(row?.metadata?.document_id || "");
    if (!targetDocumentIds.has(documentId)) preserved.push(row);
    else if (documentId === canonicalDocumentId) canonical.push(row);
    else duplicate.push(row);
  }
  return { preserved, canonical, duplicate };
}

function assertVectorPlan(desired, reusePlan) {
  const typeCounts = vectorTypeCounts(desired);
  const reusedCounts = vectorTypeCounts(reusePlan.reused);
  const missingCounts = vectorTypeCounts(reusePlan.missing);
  if (typeCounts.body !== EXPECTED.bodyVectors)
    throw new Error("unexpected_body_vector_plan");
  if (typeCounts.image !== EXPECTED.imageDescriptionVectors)
    throw new Error("unexpected_image_vector_plan");
  if (reusePlan.reused.length !== EXPECTED.reusedCanonicalVectors)
    throw new Error("unexpected_reused_vector_plan");
  if (
    reusedCounts.body !== EXPECTED.reusedBodyVectors ||
    reusedCounts.image !== EXPECTED.reusedImageDescriptionVectors
  )
    throw new Error("unexpected_reused_vector_mix");
  if (reusePlan.missing.length !== EXPECTED.missingCanonicalVectors)
    throw new Error("unexpected_missing_vector_plan");
  if (
    missingCounts.body !== EXPECTED.missingBodyVectors ||
    missingCounts.image !== EXPECTED.missingImageDescriptionVectors
  )
    throw new Error("unexpected_missing_vector_mix");
}

function targetDocIds(records = []) {
  return new Set(
    records.map(({ document_id }) => String(document_id || "")).filter(Boolean)
  );
}

function mappingsByWorkspaceGroup(workspaceRecords, mappings) {
  const byDocId = new Map();
  for (const mapping of mappings) {
    if (!byDocId.has(mapping.docId)) byDocId.set(mapping.docId, []);
    byDocId.get(mapping.docId).push(mapping);
  }
  return workspaceRecords.reduce(
    (total, record) => total + (byDocId.get(record.docId)?.length || 0),
    0
  );
}

function assertMappingIdentity(mappings, liveRows) {
  const mapped = new Set(mappings.map(({ vectorId }) => vectorId));
  const live = new Set(liveRows.map(({ id }) => id));
  if (
    mapped.size !== mappings.length ||
    live.size !== liveRows.length ||
    mapped.size !== live.size ||
    [...mapped].some((id) => !live.has(id))
  )
    throw new Error("sqlite_chroma_mapping_mismatch");
}

function buildPublicSummary({ mode, status, stats, reusePlan = null }) {
  return {
    mode,
    status,
    model: EMBEDDING_MODEL,
    maxRetries: MAX_RETRIES,
    maxBatchSize: EMBEDDING_BATCH_SIZE,
    embeddingBatchDelayMs: EMBEDDING_BATCH_DELAY_MS,
    chromaAddBatchSize: CHROMA_ADD_BATCH_SIZE,
    current: {
      workspaceDocuments: stats.workspaceDocuments,
      sqliteVectors: stats.sqliteVectors,
      chromaVectors: stats.chromaVectors,
      preservedDocuments: stats.preservedDocuments,
      canonicalDocuments: stats.canonicalDocuments,
      duplicateDocuments: stats.duplicateDocuments,
      missingCanonicalDocuments: stats.missingCanonicalDocuments,
    },
    target: {
      workspaceDocuments: EXPECTED.final.workspaceDocuments,
      vectors: EXPECTED.final.chromaVectors,
      bodyVectors: EXPECTED.bodyVectors,
      imageDescriptionVectors: EXPECTED.imageDescriptionVectors,
    },
    ...(reusePlan
      ? {
          vectorWork: {
            copiedCanonical: reusePlan.reused.length,
            needsEmbedding: reusePlan.missing.length,
            sequentialBatches: Math.ceil(
              reusePlan.missing.length / EMBEDDING_BATCH_SIZE
            ),
          },
        }
      : {}),
  };
}

async function listCollectionNames(client) {
  const collections = await client.listCollections();
  return new Set(
    (collections || [])
      .map((collection) =>
        typeof collection === "string" ? collection : collection?.name
      )
      .filter(Boolean)
  );
}

async function collectionExists(client, name) {
  return (await listCollectionNames(client)).has(name);
}

async function addRows(collection, rows, batchSize = CHROMA_ADD_BATCH_SIZE) {
  for (let index = 0; index < rows.length; index += batchSize) {
    const batch = rows.slice(index, index + batchSize);
    await collection.add({
      ids: batch.map(({ id }) => id),
      embeddings: batch.map(({ embedding }) => embedding),
      metadatas: batch.map(({ metadata }) => metadata),
      documents: batch.map(({ document }) => document),
    });
  }
}

function wait(delayMs) {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

async function embedMissingRows(
  rows,
  OpenAI,
  {
    onProgress = null,
    sleep = wait,
    batchDelayMs = EMBEDDING_BATCH_DELAY_MS,
  } = {}
) {
  const apiKey =
    process.env.GEMINI_EMBEDDING_API_KEY || process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("gemini_embedding_api_key_missing");
  const client = new OpenAI({
    apiKey,
    baseURL: "https://generativelanguage.googleapis.com/v1beta/openai/",
    maxRetries: MAX_RETRIES,
  });
  const dimensions = Number(process.env.EMBEDDING_OUTPUT_DIMENSIONS);
  const embedded = [];
  const totalBatches = Math.ceil(rows.length / EMBEDDING_BATCH_SIZE);
  for (let index = 0; index < rows.length; index += EMBEDDING_BATCH_SIZE) {
    const batch = rows.slice(index, index + EMBEDDING_BATCH_SIZE);
    const response = await client.embeddings.create({
      model: EMBEDDING_MODEL,
      input: batch.map(({ document }) => document),
      dimensions:
        Number.isFinite(dimensions) && dimensions > 0 ? dimensions : undefined,
    });
    const vectors = [...(response?.data || [])].sort(
      (left, right) => Number(left.index) - Number(right.index)
    );
    if (vectors.length !== batch.length)
      throw new Error("embedding_response_count_mismatch");
    for (const [batchIndex, row] of batch.entries()) {
      const embedding = vectors[batchIndex]?.embedding;
      if (!Array.isArray(embedding) || embedding.length === 0)
        throw new Error("embedding_vector_missing");
      embedded.push({ ...row, id: crypto.randomUUID(), embedding });
    }
    if (typeof onProgress === "function")
      await onProgress({
        completedBatches: Math.floor(index / EMBEDDING_BATCH_SIZE) + 1,
        totalBatches,
      });
    if (index + batch.length < rows.length) await sleep(batchDelayMs);
  }
  return embedded;
}

async function createSqliteBackup(prisma, storageRoot, id) {
  const exportRoot = path.resolve(storageRoot, "exports");
  fs.mkdirSync(exportRoot, { recursive: true });
  const backupPath = path.resolve(exportRoot, `guide-repair-before-${id}.db`);
  const relative = path.relative(exportRoot, backupPath);
  if (
    !relative ||
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative) ||
    fs.existsSync(backupPath)
  )
    throw new Error("sqlite_backup_path_invalid");
  const escapedPath = backupPath.replace(/'/g, "''");
  await prisma.$executeRawUnsafe(`VACUUM INTO '${escapedPath}'`);
  const stat = fs.statSync(backupPath);
  if (!stat.isFile() || stat.size === 0)
    throw new Error("sqlite_backup_failed");
  return backupPath;
}

function workspaceCreateData(record, docId, workspaceId) {
  return {
    docId,
    filename: record.filename,
    docpath: record.docpath,
    workspaceId,
    metadata: JSON.stringify(metadataForWorkspace(record.sourceData || record)),
  };
}

function workspaceRestoreData(record) {
  return {
    id: record.id,
    docId: record.docId,
    filename: record.filename,
    docpath: record.docpath,
    workspaceId: record.workspaceId,
    metadata: record.metadata,
    pinned: record.pinned,
    watched: record.watched,
    createdAt: record.createdAt,
    lastUpdatedAt: record.lastUpdatedAt,
  };
}

function vectorRestoreData(record) {
  return {
    id: record.id,
    docId: record.docId,
    vectorId: record.vectorId,
    createdAt: record.createdAt,
    lastUpdatedAt: record.lastUpdatedAt,
  };
}

async function readDatabaseStateFingerprint(prisma, workspaceId) {
  const workspaceRecords = await prisma.workspace_documents.findMany({
    where: { workspaceId },
    orderBy: { id: "asc" },
  });
  const mappings = await prisma.document_vectors.findMany({
    orderBy: { id: "asc" },
  });
  return buildDatabaseStateFingerprint({ workspaceRecords, mappings });
}

function buildDesiredDatabaseFingerprint({
  plan,
  workspaceId,
  docIdsByPath,
  existingMappings,
  existingGuideDocIds,
  canonicalMappings,
}) {
  const preservedDocuments = plan.preservedRecords.map(
    ({ dbRecord }) => dbRecord
  );
  const updatedCanonicalDocuments = plan.canonicalExistingRecords.map(
    (record) => ({
      ...record.dbRecord,
      filename: record.localRecord.filename,
      docpath: record.localRecord.docpath,
      metadata: JSON.stringify(
        metadataForWorkspace(
          record.localRecord.sourceData || record.localRecord
        )
      ),
    })
  );
  const missingDocuments = plan.missingCanonicalRecords.map((record) =>
    workspaceCreateData(record, docIdsByPath.get(record.docpath), workspaceId)
  );
  const preservedMappings = existingMappings.filter(
    ({ docId }) => !existingGuideDocIds.includes(docId)
  );
  return buildDatabaseStateFingerprint({
    workspaceRecords: [
      ...preservedDocuments,
      ...updatedCanonicalDocuments,
      ...missingDocuments,
    ],
    mappings: [...preservedMappings, ...canonicalMappings],
  });
}

async function applyDatabaseSwap({
  prisma,
  workspaceId,
  canonicalExisting,
  duplicateRows,
  missingRows,
  docIdsByPath,
  canonicalMappings,
  allExistingGuideDocIds,
}) {
  const operations = [
    prisma.document_vectors.deleteMany({
      where: { docId: { in: allExistingGuideDocIds } },
    }),
    prisma.workspace_documents.deleteMany({
      where: { id: { in: duplicateRows.map(({ id }) => id) } },
    }),
    ...canonicalExisting.map((record) => {
      const localRecord = record.localRecord;
      return prisma.workspace_documents.update({
        where: { id: record.id },
        data: {
          filename: localRecord.filename,
          docpath: localRecord.docpath,
          metadata: JSON.stringify(
            metadataForWorkspace(localRecord.sourceData || localRecord)
          ),
        },
      });
    }),
    ...missingRows.map((record) =>
      prisma.workspace_documents.create({
        data: workspaceCreateData(
          record,
          docIdsByPath.get(record.docpath),
          workspaceId
        ),
      })
    ),
    ...canonicalMappings.map((mapping) =>
      prisma.document_vectors.create({ data: mapping })
    ),
  ];
  await prisma.$transaction(operations);
}

async function restoreDatabase({
  prisma,
  canonicalExistingOriginal,
  duplicateOriginal,
  originalGuideMappings,
  newGuideDocIds,
  missingDocIds,
}) {
  const operations = [
    prisma.document_vectors.deleteMany({
      where: { docId: { in: newGuideDocIds } },
    }),
    prisma.workspace_documents.deleteMany({
      where: { docId: { in: missingDocIds } },
    }),
    ...canonicalExistingOriginal.map((record) =>
      prisma.workspace_documents.update({
        where: { id: record.id },
        data: {
          filename: record.filename,
          docpath: record.docpath,
          metadata: record.metadata,
          pinned: record.pinned,
          watched: record.watched,
          lastUpdatedAt: record.lastUpdatedAt,
        },
      })
    ),
    ...duplicateOriginal.map((record) =>
      prisma.workspace_documents.create({
        data: workspaceRestoreData(record),
      })
    ),
    ...originalGuideMappings.map((record) =>
      prisma.document_vectors.create({ data: vectorRestoreData(record) })
    ),
  ];
  await prisma.$transaction(operations);
}

function collectionRecoveryNames(names) {
  return {
    old: `${names.staging}-recover-old`,
    next: `${names.staging}-recover-new`,
    spare: `${names.staging}-recover-spare`,
  };
}

async function readCollectionRows(client, name) {
  const collection = await client.getCollection({ name });
  return collectionRows(
    await collection.get({ include: ["documents", "metadatas", "embeddings"] })
  );
}

async function readCollectionFingerprint(client, name) {
  const rows = await readCollectionRows(client, name);
  return { fingerprint: buildCollectionFingerprint(rows), rows };
}

async function inspectRepairCollections(
  client,
  names,
  { oldFingerprint, newFingerprint }
) {
  const recovery = collectionRecoveryNames(names);
  const relevantNames = [
    names.live,
    names.staging,
    names.previous,
    recovery.old,
    recovery.next,
    recovery.spare,
  ];
  const existing = await listCollectionNames(client);
  const roles = { old: [], next: [], unknown: [] };
  for (const name of relevantNames) {
    if (!existing.has(name)) continue;
    const { fingerprint } = await readCollectionFingerprint(client, name);
    if (fingerprint === oldFingerprint) roles.old.push(name);
    else if (fingerprint === newFingerprint) roles.next.push(name);
    else roles.unknown.push(name);
  }
  if (
    roles.old.length !== 1 ||
    roles.next.length !== 1 ||
    roles.unknown.length > 0
  )
    throw new Error("collection_role_state_invalid");
  return {
    old: roles.old[0],
    next: roles.next[0],
    existing,
    recovery,
  };
}

async function renameExpectedCollection(
  client,
  { from, to, expectedFingerprint }
) {
  if (from === to) return;
  const before = await listCollectionNames(client);
  if (!before.has(from)) throw new Error("collection_rename_source_missing");
  if (before.has(to)) throw new Error("collection_rename_target_exists");
  const sourceState = await readCollectionFingerprint(client, from);
  if (sourceState.fingerprint !== expectedFingerprint)
    throw new Error("collection_rename_source_mismatch");

  let renameError = null;
  try {
    const source = await client.getCollection({ name: from });
    await source.modify({ name: to });
  } catch (error) {
    renameError = error;
  }

  const after = await listCollectionNames(client);
  if (after.has(to) && !after.has(from)) {
    const targetState = await readCollectionFingerprint(client, to);
    if (targetState.fingerprint === expectedFingerprint) return;
    throw new Error("collection_rename_target_mismatch");
  }
  if (after.has(from) && !after.has(to)) {
    const unchangedState = await readCollectionFingerprint(client, from);
    if (unchangedState.fingerprint === expectedFingerprint)
      throw new Error(
        renameError ? "collection_rename_not_applied" : "collection_rename_failed"
      );
  }
  throw new Error("collection_rename_ambiguous");
}

async function cleanupVerifiedPreSwapStaging(
  client,
  names,
  oldCollectionFingerprint
) {
  const expectedPrefix = `${names.live}-reindex-`;
  if (
    !names.staging.startsWith(expectedPrefix) ||
    names.staging.length <= expectedPrefix.length ||
    names.staging === names.live ||
    names.staging === names.previous
  )
    throw new Error("staging_cleanup_name_invalid");

  const recovery = collectionRecoveryNames(names);
  const existing = await listCollectionNames(client);
  if (!existing.has(names.live))
    throw new Error("staging_cleanup_live_missing");
  if (
    existing.has(names.previous) ||
    existing.has(recovery.old) ||
    existing.has(recovery.next) ||
    existing.has(recovery.spare)
  )
    throw new Error("staging_cleanup_swap_state_detected");
  const liveState = await readCollectionFingerprint(client, names.live);
  if (liveState.fingerprint !== oldCollectionFingerprint)
    throw new Error("staging_cleanup_live_mismatch");
  if (!existing.has(names.staging)) return;

  let deleteError = null;
  try {
    await client.deleteCollection({ name: names.staging });
  } catch (error) {
    deleteError = error;
  }
  const after = await listCollectionNames(client);
  if (after.has(names.staging))
    throw new Error(
      deleteError ? "staging_cleanup_not_applied" : "staging_cleanup_failed"
    );
  const verifiedLive = await readCollectionFingerprint(client, names.live);
  if (verifiedLive.fingerprint !== oldCollectionFingerprint)
    throw new Error("staging_cleanup_live_changed");
}

async function reconcileCollectionLayout(
  client,
  names,
  fingerprints,
  desiredLayout
) {
  if (desiredLayout !== "old-live" && desiredLayout !== "new-live")
    throw new Error("collection_layout_invalid");
  const target =
    desiredLayout === "old-live"
      ? { old: names.live, next: names.staging }
      : { old: names.previous, next: names.live };
  const roleFingerprint = {
    old: fingerprints.oldFingerprint,
    next: fingerprints.newFingerprint,
  };

  for (const role of ["old", "next"]) {
    let state = await inspectRepairCollections(client, names, fingerprints);
    if (state[role] === target[role]) continue;

    const occupantRole = ["old", "next"].find(
      (candidate) => state[candidate] === target[role]
    );
    if (occupantRole) {
      const parkingNames = [
        state.recovery.old,
        state.recovery.next,
        state.recovery.spare,
      ];
      const parking = parkingNames.find(
        (name) =>
          !state.existing.has(name) &&
          name !== target.old &&
          name !== target.next
      );
      if (!parking) throw new Error("collection_recovery_parking_unavailable");
      await renameExpectedCollection(client, {
        from: state[occupantRole],
        to: parking,
        expectedFingerprint: roleFingerprint[occupantRole],
      });
      state = await inspectRepairCollections(client, names, fingerprints);
    }

    await renameExpectedCollection(client, {
      from: state[role],
      to: target[role],
      expectedFingerprint: roleFingerprint[role],
    });
  }

  const finalState = await inspectRepairCollections(client, names, fingerprints);
  if (finalState.old !== target.old || finalState.next !== target.next)
    throw new Error("collection_layout_verification_failed");
  return finalState;
}

async function validateFinalState({ prisma, client, workspace, canonicalId }) {
  const documents = await prisma.workspace_documents.findMany({
    where: { workspaceId: workspace.id },
    select: { docId: true, metadata: true },
  });
  const mappings = await prisma.document_vectors.findMany();
  const live = await client.getCollection({ name: workspace.slug });
  const rows = collectionRows(
    await live.get({ include: ["documents", "metadatas", "embeddings"] })
  );
  if (
    documents.length !== EXPECTED.final.workspaceDocuments ||
    mappings.length !== EXPECTED.final.sqliteVectors ||
    rows.length !== EXPECTED.final.chromaVectors
  )
    throw new Error("final_count_verification_failed");
  assertMappingIdentity(mappings, rows);

  const canonicalRows = rows.filter(
    ({ metadata }) => String(metadata?.document_id || "") === canonicalId
  );
  const counts = vectorTypeCounts(canonicalRows);
  if (
    canonicalRows.length !== EXPECTED.final.canonicalVectors ||
    counts.body !== EXPECTED.bodyVectors ||
    counts.image !== EXPECTED.imageDescriptionVectors
  )
    throw new Error("final_vector_scope_verification_failed");
  const targetPages = new Set(
    canonicalRows
      .filter(({ metadata }) => metadata?.content_type !== "image_description")
      .map(({ metadata }) => Number(metadata?.page))
  );
  if (REQUIRED_PAGES.some((page) => !targetPages.has(page)))
    throw new Error("required_pages_missing_after_repair");
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const prisma = require("../utils/prisma");
  const { ChromaClient } = require("chromadb");
  const { OpenAI } = require("openai");
  const { TextSplitter } = require("../utils/TextSplitter");
  const { SystemSettings } = require("../models/systemSettings");
  const storageRoot = storageDirectory();
  let client = null;

  try {
    if (process.env.VECTOR_DB !== "chroma")
      throw new Error("vector_db_must_be_chroma");
    if (process.env.EMBEDDING_ENGINE !== "gemini")
      throw new Error("embedding_engine_must_be_gemini");
    if (process.env.EMBEDDING_MODEL_PREF !== EMBEDDING_MODEL)
      throw new Error("embedding_model_scope_mismatch");

    const workspace = await prisma.workspaces.findUnique({
      where: { slug: WORKSPACE_SLUG },
    });
    if (!workspace) throw new Error("workspace_not_found");
    const rawWorkspaceRecords = await prisma.workspace_documents.findMany({
      where: { workspaceId: workspace.id },
      orderBy: { id: "asc" },
    });
    const workspaceRecords = rawWorkspaceRecords.map(enrichWorkspaceRecord);
    const localRecords = loadProcessedTargetRecords(storageRoot);
    const sourceIds = targetDocIds(localRecords);
    if (sourceIds.size !== 2) throw new Error("unexpected_source_group_count");

    const plan = buildWorkspaceRepairPlan(localRecords, workspaceRecords, {
      title: TARGET_TITLE,
      expectedPages: EXPECTED_GUIDE_PAGES,
      requiredPages: REQUIRED_PAGES,
    });
    if (
      plan.canonical.records.length !== EXPECTED_GUIDE_PAGES ||
      plan.canonical.imageDescriptionCount !==
        EXPECTED.imageDescriptionVectors
    )
      throw new Error("canonical_source_scope_mismatch");
    const initialCanonicalSourceFingerprint =
      buildCanonicalSourceFingerprint(plan.canonical.records);

    const localByPath = new Map(
      plan.canonical.records.map((record) => [record.docpath, record])
    );
    for (const record of plan.canonicalExistingRecords) {
      const localRecord = localByPath.get(record.docpath);
      if (!localRecord) throw new Error("canonical_workspace_path_missing");
      record.localRecord = localRecord;
    }

    const mappings = await prisma.document_vectors.findMany({
      orderBy: { id: "asc" },
    });
    client = new ChromaClient({ path: process.env.CHROMA_ENDPOINT });
    await client.heartbeat();
    const live = await client.getCollection({ name: workspace.slug });
    const liveRows = collectionRows(
      await live.get({ include: ["documents", "metadatas", "embeddings"] })
    );
    const initialStateFingerprint = buildRepairStateFingerprint({
      workspaceRecords: rawWorkspaceRecords,
      mappings,
      liveRows,
    });
    const initialDatabaseFingerprint = buildDatabaseStateFingerprint({
      workspaceRecords: rawWorkspaceRecords,
      mappings,
    });
    const oldCollectionFingerprint = buildCollectionFingerprint(liveRows);
    assertMappingIdentity(mappings, liveRows);
    const groupedLive = groupLiveRows(
      liveRows,
      sourceIds,
      plan.canonical.documentId
    );
    const preservedMappingCount = mappingsByWorkspaceGroup(
      plan.preservedRecords,
      mappings
    );
    const canonicalMappingCount = mappingsByWorkspaceGroup(
      plan.canonicalExistingRecords,
      mappings
    );
    const duplicateMappingCount = mappingsByWorkspaceGroup(
      plan.duplicateTargetRecords,
      mappings
    );
    if (
      groupedLive.preserved.length !== preservedMappingCount ||
      groupedLive.canonical.length !== canonicalMappingCount ||
      groupedLive.duplicate.length !== duplicateMappingCount
    )
      throw new Error("workspace_vector_group_mismatch");

    const stats = {
      workspaceDocuments: workspaceRecords.length,
      sqliteVectors: mappings.length,
      chromaVectors: liveRows.length,
      preservedDocuments: plan.preservedRecords.length,
      preservedVectors: groupedLive.preserved.length,
      canonicalDocuments: plan.canonicalExistingRecords.length,
      canonicalVectors: groupedLive.canonical.length,
      duplicateDocuments: plan.duplicateTargetRecords.length,
      duplicateVectors: groupedLive.duplicate.length,
      missingCanonicalDocuments: plan.missingCanonicalRecords.length,
    };
    const scope = assertKnownRepairScope(stats);
    if (scope === "noop") {
      const canonicalCounts = vectorTypeCounts(groupedLive.canonical);
      if (
        canonicalCounts.body !== EXPECTED.bodyVectors ||
        canonicalCounts.image !== EXPECTED.imageDescriptionVectors
      )
        throw new Error("completed_scope_vector_mix_mismatch");
      console.log(
        JSON.stringify(
          buildPublicSummary({
            mode: args.apply ? "apply" : "dry-run",
            status: "already_complete",
            stats,
          })
        )
      );
      return;
    }

    const chunkSize = Math.min(
      Number(
        await SystemSettings.getValueOrFallback(
          { label: "text_splitter_chunk_size" },
          SCHAT_CHUNK_SIZE
        )
      ) || SCHAT_CHUNK_SIZE,
      SCHAT_CHUNK_SIZE
    );
    const requestedOverlap =
      Number(
        await SystemSettings.getValueOrFallback(
          { label: "text_splitter_chunk_overlap" },
          SCHAT_CHUNK_OVERLAP
        )
      ) || SCHAT_CHUNK_OVERLAP;
    const chunkOverlap = Math.min(
      requestedOverlap,
      Math.max(0, chunkSize - 1)
    );
    if (
      chunkSize !== SCHAT_CHUNK_SIZE ||
      chunkOverlap !== SCHAT_CHUNK_OVERLAP
    )
      throw new Error("chunk_policy_scope_mismatch");

    const docIdsByPath = new Map(
      plan.canonicalExistingRecords.map((record) => [
        record.docpath,
        record.docId,
      ])
    );
    for (const record of plan.missingCanonicalRecords)
      docIdsByPath.set(record.docpath, crypto.randomUUID());
    const desired = await buildDesiredVectors({
      records: plan.canonical.records,
      docIdsByPath,
      TextSplitter,
      chunkSize,
      chunkOverlap,
    });
    const reusePlan = buildVectorReusePlan(desired, groupedLive.canonical);
    assertVectorPlan(desired, reusePlan);

    if (!args.apply) {
      console.log(
        JSON.stringify(
          buildPublicSummary({
            mode: "dry-run",
            status: "ready",
            stats,
            reusePlan,
          })
        )
      );
      return;
    }

    const id = process.env.SCHAT_GUIDE_REPAIR_RUN_ID || runId();
    if (!/^[0-9A-Za-z_-]{6,20}$/.test(id))
      throw new Error("repair_run_id_invalid");
    const names = buildReindexCollectionNames(workspace.slug, id);
    if (await collectionExists(client, names.staging))
      throw new Error("staging_collection_exists");
    if (await collectionExists(client, names.previous))
      throw new Error("previous_collection_exists");

    const usersBefore = await prisma.users.count();
    const chatsBefore = await prisma.workspace_chats.count();
    const backupPath = await runRepairPhase(
      "repair_phase_backup_failed",
      () => createSqliteBackup(prisma, storageRoot, id)
    );
    let staging = null;
    const canonicalExistingOriginal = plan.canonicalExistingRecords.map(
      ({ dbRecord }) => dbRecord
    );
    const duplicateOriginal = plan.duplicateTargetRecords.map(
      ({ dbRecord }) => dbRecord
    );
    const existingGuideDocIds = [
      ...plan.canonicalExistingRecords,
      ...plan.duplicateTargetRecords,
    ].map(({ docId }) => docId);
    const originalGuideMappings = mappings.filter(({ docId }) =>
      existingGuideDocIds.includes(docId)
    );
    const missingDocIds = plan.missingCanonicalRecords.map((record) =>
      docIdsByPath.get(record.docpath)
    );
    const newGuideDocIds = [
      ...plan.canonicalExistingRecords.map(({ docId }) => docId),
      ...missingDocIds,
    ];
    let desiredDatabaseFingerprint = null;
    let collectionFingerprints = null;
    let collectionSwapStarted = false;

    try {
      staging = await runRepairPhase(
        "repair_phase_staging_create_failed",
        () =>
          client.createCollection({
            name: names.staging,
            metadata: {
              "hnsw:space": "cosine",
              "schat:chunk_policy": SCHAT_CHUNK_POLICY_VERSION,
            },
          })
      );
      await runRepairPhase("repair_phase_preserved_copy_failed", () =>
        addRows(staging, groupedLive.preserved)
      );
      const canonicalRows = await runRepairPhase(
        "repair_phase_embedding_failed",
        async () => {
          const embeddedRows = await embedMissingRows(
            reusePlan.missing,
            OpenAI,
            {
              onProgress: ({ completedBatches, totalBatches }) => {
                if (
                  completedBatches % 10 === 0 ||
                  completedBatches === totalBatches
                )
                  console.log(
                    JSON.stringify({
                      phase: "embedding",
                      completedBatches,
                      totalBatches,
                    })
                  );
              },
            }
          );
          const rows = [...reusePlan.reused, ...embeddedRows];
          const existingDimension = groupedLive.preserved[0]?.embedding?.length;
          if (
            !existingDimension ||
            rows.some(({ embedding }) => embedding?.length !== existingDimension)
          )
            throw new Error("embedding_dimension_mismatch");
          return rows;
        }
      );
      await runRepairPhase("repair_phase_chroma_add_failed", () =>
        addRows(staging, canonicalRows)
      );
      await runRepairPhase("repair_phase_staging_count_failed", async () => {
        if ((await staging.count()) !== EXPECTED.final.chromaVectors)
          throw new Error("staging_vector_count_mismatch");
      });

      await runRepairPhase("repair_phase_source_recheck_failed", async () => {
        const currentWorkspaceRecords =
          await prisma.workspace_documents.findMany({
            where: { workspaceId: workspace.id },
            orderBy: { id: "asc" },
          });
        const currentMappings = await prisma.document_vectors.findMany({
          orderBy: { id: "asc" },
        });
        const currentLive = await client.getCollection({ name: names.live });
        const currentLiveRows = collectionRows(
          await currentLive.get({
            include: ["documents", "metadatas", "embeddings"],
          })
        );
        if (
          buildRepairStateFingerprint({
            workspaceRecords: currentWorkspaceRecords,
            mappings: currentMappings,
            liveRows: currentLiveRows,
          }) !== initialStateFingerprint
        )
          throw new Error("repair_source_changed_during_staging");

        const currentLocalRecords = loadProcessedTargetRecords(storageRoot);
        const currentCanonical = selectPreferredCompleteDocumentGroup(
          currentLocalRecords,
          {
            title: TARGET_TITLE,
            expectedPages: EXPECTED_GUIDE_PAGES,
            requiredPages: REQUIRED_PAGES,
          }
        );
        if (
          currentCanonical.documentId !== plan.canonical.documentId ||
          buildCanonicalSourceFingerprint(currentCanonical.records) !==
            initialCanonicalSourceFingerprint
        )
          throw new Error("repair_local_source_changed_during_staging");
      });

      const canonicalMappings = canonicalRows.map(({ docId, id: vectorId }) => ({
        docId,
        vectorId,
      }));
      await runRepairPhase("repair_phase_staging_mapping_failed", async () => {
        if (canonicalMappings.length !== EXPECTED.final.canonicalVectors)
          throw new Error("canonical_mapping_count_mismatch");
      });

      desiredDatabaseFingerprint = buildDesiredDatabaseFingerprint({
        plan,
        workspaceId: workspace.id,
        docIdsByPath,
        existingMappings: mappings,
        existingGuideDocIds,
        canonicalMappings,
      });
      const expectedStagingRows = [
        ...groupedLive.preserved,
        ...canonicalRows,
      ];
      await runRepairPhase("repair_phase_staging_fingerprint_failed", async () => {
        const storedStagingRows = await readCollectionRows(
          client,
          names.staging
        );
        const diagnostic = summarizeCollectionRoundTrip(
          expectedStagingRows,
          storedStagingRows
        );
        if (!isSafeCollectionRoundTrip(diagnostic)) {
          console.log(
            JSON.stringify({
              phase: "staging_fingerprint_diagnostic",
              ...diagnostic,
            })
          );
          throw new Error("staging_collection_fingerprint_mismatch");
        }
        collectionFingerprints = {
          oldFingerprint: oldCollectionFingerprint,
          newFingerprint: buildCollectionFingerprint(storedStagingRows),
        };
      });

      collectionSwapStarted = true;
      await runRepairPhase(
        "repair_phase_collection_swap_failed",
        () =>
          reconcileCollectionLayout(
            client,
            names,
            collectionFingerprints,
            "new-live"
          )
      );
      await runRepairPhase("repair_phase_database_swap_failed", async () => {
        await applyDatabaseSwap({
          prisma,
          workspaceId: workspace.id,
          canonicalExisting: plan.canonicalExistingRecords,
          duplicateRows: plan.duplicateTargetRecords,
          missingRows: plan.missingCanonicalRecords,
          docIdsByPath,
          canonicalMappings,
          allExistingGuideDocIds: existingGuideDocIds,
        });
        if (
          (await readDatabaseStateFingerprint(prisma, workspace.id)) !==
          desiredDatabaseFingerprint
        )
          throw new Error("database_swap_verification_failed");
      });
      await runRepairPhase("repair_phase_final_verify_failed", async () => {
        await validateFinalState({
          prisma,
          client,
          workspace,
          canonicalId: plan.canonical.documentId,
        });
        const usersAfter = await prisma.users.count();
        const chatsAfter = await prisma.workspace_chats.count();
        if (usersAfter !== usersBefore || chatsAfter !== chatsBefore)
          throw new Error("accounts_or_chats_changed");
      });

      console.log(
        JSON.stringify({
          ...buildPublicSummary({
            mode: "apply",
            status: "complete",
            stats,
            reusePlan,
          }),
          result: {
            sqliteBackup: path.basename(backupPath),
            previousCollectionRetained: true,
            finalWorkspaceDocuments: EXPECTED.final.workspaceDocuments,
            finalVectors: EXPECTED.final.chromaVectors,
          },
        })
      );
    } catch (error) {
      let databaseState = "unknown";
      try {
        const currentFingerprint = await readDatabaseStateFingerprint(
          prisma,
          workspace.id
        );
        databaseState = classifyDatabaseFingerprint(currentFingerprint, {
          initialFingerprint: initialDatabaseFingerprint,
          desiredFingerprint: desiredDatabaseFingerprint,
        });
      } catch {
        databaseState = "unknown";
      }

      if (!collectionSwapStarted) {
        if (databaseState !== "initial")
          throw new Error("repair_database_state_unknown");
        try {
          await cleanupVerifiedPreSwapStaging(
            client,
            names,
            oldCollectionFingerprint
          );
        } catch {
          throw new Error("repair_pre_swap_cleanup_incomplete");
        }
        throw error;
      }

      if (databaseState === "desired") {
        try {
          await restoreDatabase({
            prisma,
            canonicalExistingOriginal,
            duplicateOriginal,
            originalGuideMappings,
            newGuideDocIds,
            missingDocIds,
          });
        } catch {
          // The transaction may have completed despite a client error. The
          // authoritative read below decides which Chroma layout is safe.
        }
        try {
          const restoredFingerprint = await readDatabaseStateFingerprint(
            prisma,
            workspace.id
          );
          databaseState = classifyDatabaseFingerprint(restoredFingerprint, {
            initialFingerprint: initialDatabaseFingerprint,
            desiredFingerprint: desiredDatabaseFingerprint,
          });
        } catch {
          databaseState = "unknown";
        }
      }

      if (!collectionFingerprints)
        throw new Error("repair_collection_state_unknown");
      const recoveryLayout = collectionLayoutForDatabaseState(databaseState);

      try {
        await reconcileCollectionLayout(
          client,
          names,
          collectionFingerprints,
          recoveryLayout
        );
      } catch {
        throw new Error("repair_collection_recovery_incomplete");
      }
      if (databaseState === "desired")
        throw new Error("repair_database_rollback_incomplete");
      throw error;
    }
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(
      JSON.stringify({ phase: "failed", error: publicErrorCode(error) })
    );
    process.exitCode = 1;
  });
}

module.exports = {
  addRows,
  applyDatabaseSwap,
  assertVectorPlan,
  assertKnownRepairScope,
  buildCanonicalSourceFingerprint,
  buildCollectionFingerprint,
  buildDatabaseStateFingerprint,
  buildRepairStateFingerprint,
  buildVectorReusePlan,
  classifyDatabaseFingerprint,
  cleanupVerifiedPreSwapStaging,
  collectionLayoutForDatabaseState,
  createSqliteBackup,
  embedMissingRows,
  isSafeCollectionRoundTrip,
  parseArgs,
  publicErrorCode,
  reconcileCollectionLayout,
  restoreDatabase,
  runRepairPhase,
  summarizeCollectionRoundTrip,
};
