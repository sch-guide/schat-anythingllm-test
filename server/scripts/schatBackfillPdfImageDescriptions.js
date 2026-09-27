const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { OpenAI } = require("openai");
const { v5: uuidv5 } = require("uuid");
const { ChromaClient } = require("chromadb");

const IMAGE_KEY_PATTERN = /^[a-f0-9]{64}$/;
const EMBEDDING_MODEL = "gemini-embedding-2";
const EMBEDDING_BATCH_SIZE = 4;
const APPROVED_MAX_IMAGES = 1172;
const APPROVED_MAX_VISION_CALLS = 1138;

function parseMetadata(value) {
  if (value && typeof value === "object") return value;
  if (typeof value !== "string") return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function collectImageOccurrences(rows = [], targetDocumentId = "") {
  const occurrences = new Map();
  for (const row of rows) {
    const metadata = parseMetadata(row?.metadata);
    if (metadata?.document_id !== targetDocumentId) continue;
    if (!Array.isArray(metadata.pdf_images)) continue;
    for (const image of metadata.pdf_images) {
      const imageKey = String(image?.image_key || "");
      if (!IMAGE_KEY_PATTERN.test(imageKey)) continue;
      if (!occurrences.has(imageKey)) {
        occurrences.set(imageKey, {
          imageKey,
          description: "",
          rows: [],
        });
      }
      const occurrence = occurrences.get(imageKey);
      const description =
        typeof image.description === "string" ? image.description.trim() : "";
      if (!occurrence.description && description)
        occurrence.description = description;
      occurrence.rows.push({ row, metadata, image });
    }
  }
  return occurrences;
}

function selectSingleImageDocumentId(rows = []) {
  const documentIds = new Set();
  for (const row of rows) {
    const metadata = parseMetadata(row?.metadata);
    if (
      typeof metadata?.document_id === "string" &&
      metadata.document_id &&
      Array.isArray(metadata.pdf_images) &&
      metadata.pdf_images.some((image) =>
        IMAGE_KEY_PATTERN.test(String(image?.image_key || ""))
      )
    )
      documentIds.add(metadata.document_id);
  }
  if (documentIds.size !== 1)
    throw new Error(`image_document_scope_not_unique:${documentIds.size}`);
  return [...documentIds][0];
}

function planImageBackfill({
  occurrences = new Map(),
  indexedDescriptions = new Map(),
  cachedDescriptions = new Map(),
  terminalCacheKeys = new Set(),
} = {}) {
  const descriptions = new Map();
  const needsDescription = [];
  const needsIndex = [];
  const terminalWithoutDescription = [];
  for (const [imageKey, occurrence] of occurrences) {
    const description = String(
      occurrence.description ||
        indexedDescriptions.get(imageKey) ||
        cachedDescriptions.get(imageKey) ||
        ""
    ).trim();
    const indexedDescription = String(
      indexedDescriptions.get(imageKey) || ""
    ).trim();
    const isTerminalWithoutDescription =
      !description && terminalCacheKeys.has(imageKey);
    if (description) descriptions.set(imageKey, description);
    else if (isTerminalWithoutDescription)
      terminalWithoutDescription.push(imageKey);
    else needsDescription.push(imageKey);
    if (
      !isTerminalWithoutDescription &&
      (!indexedDescription || indexedDescription !== description)
    )
      needsIndex.push(imageKey);
  }
  return {
    descriptions,
    needsDescription,
    needsIndex,
    terminalWithoutDescription,
  };
}

function assertApprovedBackfillCeilings({
  imageCount,
  missingDescriptions,
  maxImages = APPROVED_MAX_IMAGES,
  maxVisionCalls = APPROVED_MAX_VISION_CALLS,
}) {
  if (imageCount > maxImages)
    throw new Error(`approved_image_limit_exceeded:${imageCount}`);
  if (missingDescriptions > maxVisionCalls)
    throw new Error(
      `approved_vision_limit_exceeded:${missingDescriptions}`
    );
}

function splitIntoBatches(values = [], batchSize = 50) {
  const size = Math.max(1, Number(batchSize) || 50);
  const batches = [];
  for (let index = 0; index < values.length; index += size)
    batches.push(values.slice(index, index + size));
  return batches;
}

function readCachedDescriptionState(storageRoot, imageKeys = []) {
  const descriptions = new Map();
  const terminalKeys = new Set();
  const cacheRoot = path.resolve(storageRoot, ".description-cache");
  for (const imageKey of imageKeys) {
    try {
      const value = JSON.parse(
        fs.readFileSync(path.resolve(cacheRoot, `${imageKey}.json`), "utf8")
      );
      if (value.imageKey !== imageKey) continue;
      const description =
        typeof value.description === "string" ? value.description.trim() : "";
      const status = String(value.status || (description ? "success" : ""));
      if (!description && !["empty", "failed"].includes(status)) continue;
      terminalKeys.add(imageKey);
      if (description) descriptions.set(imageKey, description);
    } catch {}
  }
  return { descriptions, terminalKeys };
}

function progressPath(storageRoot, scopeKey) {
  const safeScope = crypto
    .createHash("sha256")
    .update(String(scopeKey || ""))
    .digest("hex")
    .slice(0, 16);
  return path.resolve(
    storageRoot,
    ".description-cache",
    `backfill-progress-${safeScope}.json`
  );
}

function writeBackfillProgress(storageRoot, scopeKey, progress = {}) {
  const filename = progressPath(storageRoot, scopeKey);
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  atomicWriteJson(filename, progress);
}

function readBackfillProgress(storageRoot, scopeKey) {
  try {
    return JSON.parse(
      fs.readFileSync(progressPath(storageRoot, scopeKey), "utf8")
    );
  } catch {
    return null;
  }
}

function collectIndexedImageDescriptions(result = {}, targetDocumentId) {
  const descriptions = new Map();
  const vectorIds = new Map();
  const duplicateVectorIds = [];
  for (let index = 0; index < (result.ids || []).length; index += 1) {
    const metadata = result.metadatas?.[index] || {};
    const imageKey = String(metadata.image_key || "");
    if (
      metadata.document_id !== targetDocumentId ||
      !IMAGE_KEY_PATTERN.test(imageKey)
    )
      continue;
    if (vectorIds.has(imageKey)) {
      duplicateVectorIds.push(result.ids[index]);
      continue;
    }
    const description = String(result.documents?.[index] || "").trim();
    if (description) descriptions.set(imageKey, description);
    vectorIds.set(imageKey, result.ids[index]);
  }
  return { descriptions, vectorIds, duplicateVectorIds };
}

function summarizeVectorChanges({ needsIndex = [], indexed } = {}) {
  const vectorIds = indexed?.vectorIds || new Map();
  const duplicateVectorIds = indexed?.duplicateVectorIds || [];
  const plannedVectorUpdates = needsIndex.filter((imageKey) =>
    vectorIds.has(imageKey)
  ).length;
  return {
    existingImageDescriptionVectors:
      vectorIds.size + duplicateVectorIds.length,
    existingUniqueImageVectors: vectorIds.size,
    plannedVectorUpserts: needsIndex.length,
    plannedNewVectors: needsIndex.length - plannedVectorUpdates,
    plannedVectorUpdates,
  };
}

function applyDescriptionsToDocumentData(data = {}, descriptions = new Map()) {
  if (!Array.isArray(data.pdf_images)) return { ...data };
  const images = data.pdf_images;
  return {
    ...data,
    pdf_images: images.map((image) => {
      const description = descriptions.get(image?.image_key);
      return description
        ? { ...image, description }
        : { ...image };
    }),
  };
}

function parseArgs(argv = []) {
  const args = {
    apply: false,
    embeddingOnly: false,
    workspace: "",
    documentId: "",
    maxCalls: 0,
    batchSize: 50,
    autoDocument: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--apply") args.apply = true;
    else if (value === "--embedding-only") args.embeddingOnly = true;
    else if (value === "--auto-document") args.autoDocument = true;
    else if (value === "--workspace") args.workspace = argv[++index] || "";
    else if (value === "--document-id") args.documentId = argv[++index] || "";
    else if (value === "--max-calls") args.maxCalls = Number(argv[++index]);
    else if (value === "--batch-size")
      args.batchSize = Number(argv[++index]);
    else if (value === "--expected-missing")
      args.expectedMissing = Number(argv[++index]);
    else if (value === "--expected-missing-vectors")
      args.expectedMissingVectors = Number(argv[++index]);
    else if (value === "--expected-rows")
      args.expectedRows = Number(argv[++index]);
    else if (value === "--expected-images")
      args.expectedImages = Number(argv[++index]);
    else if (value === "--expected-body-vectors")
      args.expectedBodyVectors = Number(argv[++index]);
    else if (value === "--expected-body-hash")
      args.expectedBodyHash = String(argv[++index] || "");
    else throw new Error(`unknown_argument:${value}`);
  }
  if (!args.workspace) throw new Error("workspace_required");
  if (
    !args.autoDocument &&
    !/^[a-f0-9-]{16,64}$/i.test(args.documentId)
  )
    throw new Error("document_id_required");
  if (args.autoDocument && args.documentId)
    throw new Error("document_scope_conflict");
  if (
    args.apply &&
    (!Number.isInteger(args.maxCalls) ||
      args.maxCalls < (args.embeddingOnly ? 0 : 1))
  )
    throw new Error(
      args.embeddingOnly
        ? "non_negative_max_calls_required"
        : "positive_max_calls_required"
    );
  if (!Number.isInteger(args.batchSize) || args.batchSize < 1)
    throw new Error("positive_batch_size_required");
  if (args.apply) {
    for (const key of [
      "expectedMissing",
      "expectedMissingVectors",
      "expectedRows",
      "expectedImages",
      "expectedBodyVectors",
    ]) {
      if (!Number.isInteger(args[key]) || args[key] < 0)
        throw new Error(`${key}_required`);
    }
    if (!IMAGE_KEY_PATTERN.test(args.expectedBodyHash))
      throw new Error("expectedBodyHash_required");
  }
  return args;
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

async function bodyVectorSnapshot(collection) {
  const result = await collection.get({
    include: ["documents", "metadatas", "embeddings"],
  });
  const rows = result.ids
    .map((id, index) => ({
      id,
      document: result.documents?.[index] ?? null,
      metadata: result.metadatas?.[index] ?? null,
      embedding: result.embeddings?.[index] ?? null,
    }))
    .filter(({ metadata }) => metadata?.content_type !== "image_description")
    .sort((left, right) => left.id.localeCompare(right.id));
  return { count: rows.length, hash: hashValue(rows) };
}

function selectVectorId({ workspace, docId, imageKey, existingVectorId }) {
  return (
    existingVectorId ||
    uuidv5(`${workspace}:${docId}:${imageKey}`, uuidv5.URL)
  );
}

function assertBackfillScope({
  imageRowCount,
  imageCount,
  missingDescriptions,
  missingVectors,
  bodyVectorCount,
  expectedRows,
  expectedImages,
  expectedMissing,
  expectedMissingVectors,
  expectedBodyVectors,
  bodyVectorHash,
  expectedBodyHash,
}) {
  if (imageRowCount !== expectedRows)
    throw new Error(`unexpected_image_row_count:${imageRowCount}`);
  if (imageCount !== expectedImages)
    throw new Error(`unexpected_image_count:${imageCount}`);
  if (bodyVectorCount !== expectedBodyVectors)
    throw new Error(`unexpected_body_vector_count:${bodyVectorCount}`);
  if (bodyVectorHash !== expectedBodyHash)
    throw new Error(`unexpected_body_vector_hash:${bodyVectorHash}`);
  if (missingDescriptions > expectedMissing)
    throw new Error(`unexpected_missing_count:${missingDescriptions}`);
  if (missingVectors > expectedMissingVectors)
    throw new Error(`unexpected_missing_vector_count:${missingVectors}`);
}

function verifiedImageBuffer({ imageKey, imagePath, storageRoot }) {
  const stat = fs.lstatSync(imagePath);
  if (!stat.isFile() || stat.isSymbolicLink())
    throw new Error(`image_file_invalid:${imageKey}`);
  const realRoot = fs.realpathSync(storageRoot);
  const realImage = fs.realpathSync(imagePath);
  const relative = path.relative(realRoot, realImage);
  if (
    !relative ||
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  )
    throw new Error(`image_path_invalid:${imageKey}`);
  const buffer = fs.readFileSync(realImage);
  const actualKey = crypto.createHash("sha256").update(buffer).digest("hex");
  if (actualKey !== imageKey) throw new Error(`image_hash_mismatch:${imageKey}`);
  return buffer;
}

async function embedDescriptionsNoRetry(descriptions = []) {
  const apiKey =
    process.env.GEMINI_EMBEDDING_API_KEY || process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("gemini_embedding_api_key_missing");
  const client = new OpenAI({
    apiKey,
    baseURL: "https://generativelanguage.googleapis.com/v1beta/openai/",
    maxRetries: 0,
  });
  const dimensions = Number(process.env.EMBEDDING_OUTPUT_DIMENSIONS);
  if (descriptions.length > EMBEDDING_BATCH_SIZE)
    throw new Error("image_embedding_batch_too_large");
  const response = await client.embeddings.create({
    model: EMBEDDING_MODEL,
    input: descriptions,
    dimensions:
      Number.isFinite(dimensions) && dimensions > 0 ? dimensions : undefined,
  });
  if (
    !Array.isArray(response?.data) ||
    response.data.length !== descriptions.length
  )
    throw new Error("image_embedding_count_mismatch");
  const vectors = [];
  for (const item of response.data) {
    if (!Array.isArray(item?.embedding) || item.embedding.length === 0)
      throw new Error("image_embedding_missing");
    vectors.push(item.embedding);
  }
  return vectors;
}

async function processEmbeddingBatches({
  items = [],
  batchSize = EMBEDDING_BATCH_SIZE,
  embedBatch,
  upsertBatch,
  onBatchComplete = null,
} = {}) {
  let completedBatches = 0;
  let embeddingRequests = 0;
  let vectorsUpserted = 0;
  for (const batch of splitIntoBatches(items, batchSize)) {
    embeddingRequests += 1;
    const vectors = await embedBatch(
      batch.map(({ description }) => description)
    );
    if (!Array.isArray(vectors) || vectors.length !== batch.length)
      throw new Error("image_embedding_count_mismatch");
    await upsertBatch(batch, vectors);
    completedBatches += 1;
    vectorsUpserted += batch.length;
    if (typeof onBatchComplete === "function") {
      await onBatchComplete({
        completedBatches,
        embeddingRequests,
        vectorsUpserted,
      });
    }
  }
  return { completedBatches, embeddingRequests, vectorsUpserted };
}

function atomicWriteJson(filename, value) {
  const temporary = `${filename}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(value), "utf8");
  fs.renameSync(temporary, filename);
}

async function indexedImageDescriptions(collection, targetDocumentId) {
  const result = await collection.get({
    where: { content_type: "image_description" },
    include: ["documents", "metadatas"],
  });
  return collectIndexedImageDescriptions(result, targetDocumentId);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (process.env.VECTOR_DB !== "chroma")
    throw new Error("VECTOR_DB_must_be_chroma");
  if (process.env.EMBEDDING_ENGINE !== "gemini")
    throw new Error("EMBEDDING_ENGINE_must_be_gemini");
  if (process.env.EMBEDDING_MODEL_PREF !== EMBEDDING_MODEL)
    throw new Error(`EMBEDDING_MODEL_PREF_must_be_${EMBEDDING_MODEL}`);
  const prisma = require("../utils/prisma");
  const {
    documentsPath,
    fileData,
    isWithin,
    normalizePath,
    purgeVectorCache,
  } = require("../utils/files");
  const {
    searchableChunkMetadata,
    SCHAT_CHUNK_POLICY_VERSION,
  } = require("../utils/vectorDbProviders/chroma/schatPolicy");
  const {
    sanitizeChromaMetadata,
  } = require("../utils/vectorDbProviders/chroma/reindexContract");
  const { resolveWorkspaceImage } = require("../utils/documentImages");
  const {
    createGeminiImageDescriber,
    writeDescriptionCacheRecord,
  } = require("../../collector/processSingleFile/convert/asPDF/pdfImages");

  const workspace = await prisma.workspaces.findUnique({
    where: { slug: args.workspace },
  });
  if (!workspace) throw new Error("workspace_not_found");
  const rows = await prisma.workspace_documents.findMany({
    where: { workspaceId: workspace.id },
    orderBy: { id: "asc" },
  });
  const targetDocumentId = args.autoDocument
    ? selectSingleImageDocumentId(rows)
    : args.documentId;
  const occurrences = collectImageOccurrences(rows, targetDocumentId);
  if (occurrences.size === 0) throw new Error("target_images_not_found");

  const chroma = new ChromaClient({ path: process.env.CHROMA_ENDPOINT });
  const collection = await chroma.getCollection({ name: args.workspace });
  const bodyBefore = await bodyVectorSnapshot(collection);
  const indexed = await indexedImageDescriptions(collection, targetDocumentId);
  const storageRoot = path.resolve(process.env.STORAGE_DIR, "document-images");
  const cached = readCachedDescriptionState(
    storageRoot,
    Array.from(occurrences.keys())
  );
  const plan = planImageBackfill({
    occurrences,
    indexedDescriptions: indexed.descriptions,
    cachedDescriptions: cached.descriptions,
    terminalCacheKeys: cached.terminalKeys,
  });
  assertApprovedBackfillCeilings({
    imageCount: occurrences.size,
    missingDescriptions: plan.needsDescription.length,
  });
  const imageRows = Array.from(
    new Map(
      Array.from(occurrences.values())
        .flatMap((occurrence) => occurrence.rows)
        .map(({ row }) => [row.id, row])
    ).values()
  );

  const summary = {
    mode: args.apply ? "apply" : "dry-run",
    embeddingOnly: args.embeddingOnly,
    targetImages: occurrences.size,
    imageRows: imageRows.length,
    missingDescriptions: plan.needsDescription.length,
    missingVectors: plan.needsIndex.length,
    cachedDescriptions: cached.descriptions.size,
    terminalWithoutDescription: plan.terminalWithoutDescription.length,
    plannedVisionCalls: plan.needsDescription.length,
    plannedBatches: splitIntoBatches(
      plan.needsDescription,
      args.batchSize
    ).length,
    plannedEmbeddingRequests: Math.ceil(
      plan.needsIndex.length / EMBEDDING_BATCH_SIZE
    ),
    duplicateImageVectors: indexed.duplicateVectorIds.length,
    ...summarizeVectorChanges({
      needsIndex: plan.needsIndex,
      indexed,
    }),
    bodyVectors: bodyBefore.count,
    bodyHash: bodyBefore.hash,
  };
  console.log(JSON.stringify(summary));
  if (!args.apply) return;
  assertBackfillScope({
    imageRowCount: imageRows.length,
    imageCount: occurrences.size,
    missingDescriptions: plan.needsDescription.length,
    missingVectors: plan.needsIndex.length,
    bodyVectorCount: bodyBefore.count,
    expectedRows: args.expectedRows,
    expectedImages: args.expectedImages,
    expectedMissing: args.expectedMissing,
    expectedMissingVectors: args.expectedMissingVectors,
    expectedBodyVectors: args.expectedBodyVectors,
    bodyVectorHash: bodyBefore.hash,
    expectedBodyHash: args.expectedBodyHash,
  });
  if (plan.needsDescription.length > args.maxCalls)
    throw new Error(`max_calls_exceeded:${plan.needsDescription.length}`);
  if (args.embeddingOnly && plan.needsDescription.length > 0)
    throw new Error(
      `embedding_only_missing_descriptions:${plan.needsDescription.length}`
    );

  const describeImage = args.embeddingOnly
    ? null
    : createGeminiImageDescriber();
  const cacheRoot = path.resolve(storageRoot, ".description-cache");
  fs.mkdirSync(cacheRoot, { recursive: true });
  let descriptionCalls = 0;
  let descriptionSuccess = 0;
  let emptyDescriptions = 0;
  let descriptionFailures = 0;
  let completedBatches = 0;
  for (const batch of splitIntoBatches(plan.needsDescription, args.batchSize)) {
    for (const imageKey of batch) {
      descriptionCalls += 1;
      let cacheRecord;
      try {
        const imagePath = resolveWorkspaceImage({
          imageKey,
          storageRoot,
          documents: rows,
        });
        if (!imagePath) throw new Error("image_not_found");
        const imageBuffer = verifiedImageBuffer({
          imageKey,
          imagePath,
          storageRoot,
        });
        const description = String(await describeImage(imageBuffer)).trim();
        cacheRecord = {
          imageKey,
          description,
          status: description ? "success" : "empty",
        };
        if (description) {
          plan.descriptions.set(imageKey, description);
          descriptionSuccess += 1;
        } else {
          emptyDescriptions += 1;
        }
      } catch {
        cacheRecord = { imageKey, description: "", status: "failed" };
        descriptionFailures += 1;
      }
      writeDescriptionCacheRecord(
        path.resolve(cacheRoot, `${imageKey}.json`),
        cacheRecord
      );
    }
    completedBatches += 1;
    writeBackfillProgress(storageRoot, targetDocumentId, {
      completedBatches,
      attempted: descriptionCalls,
      success: descriptionSuccess,
      empty: emptyDescriptions,
      failed: descriptionFailures,
    });
  }

  let documentsUpdated = 0;
  const needsIndex = new Set(
    Array.from(plan.descriptions.keys()).filter(
      (imageKey) =>
        indexed.descriptions.get(imageKey) !== plan.descriptions.get(imageKey)
    )
  );
  for (const row of imageRows) {
    const data = await fileData(row.docpath);
    if (!data) throw new Error(`document_file_missing:${row.id}`);
    const updated = applyDescriptionsToDocumentData(data, plan.descriptions);
    const filename = path.resolve(documentsPath, normalizePath(row.docpath));
    if (!isWithin(documentsPath, filename))
      throw new Error(`document_path_invalid:${row.id}`);
    const fileChanged = hashValue(updated) !== hashValue(data);
    const { pageContent: _pageContent, ...metadata } = updated;
    const metadataChanged = hashValue(metadata) !== hashValue(parseMetadata(row.metadata));
    const rowNeedsIndex = Array.isArray(metadata.pdf_images) &&
      metadata.pdf_images.some(({ image_key: imageKey }) => needsIndex.has(imageKey));
    if (fileChanged) atomicWriteJson(filename, updated);
    if (metadataChanged) {
      await prisma.workspace_documents.update({
        where: { id: row.id },
        data: { metadata: JSON.stringify(metadata) },
      });
    }
    if (fileChanged || rowNeedsIndex)
      await purgeVectorCache(
        `${row.docpath}::${SCHAT_CHUNK_POLICY_VERSION}`
      );
    if (fileChanged || metadataChanged) documentsUpdated += 1;
  }

  const pending = [];
  for (const imageKey of needsIndex) {
    const occurrence = occurrences.get(imageKey);
    const first = occurrence?.rows?.[0];
    const description = plan.descriptions.get(imageKey);
    if (!first || !description)
      throw new Error(`index_data_missing:${imageKey}`);
    const metadata = parseMetadata(first.row.metadata) || {};
    const { pdf_images: _pdfImages, ...publicMetadata } = metadata;
    const storedMetadata = sanitizeChromaMetadata(
      searchableChunkMetadata(
        {
          ...publicMetadata,
          content_type: "image_description",
          image_key: imageKey,
        },
        description
      ).metadata
    );
    pending.push({
      imageKey,
      description,
      row: first.row,
      metadata: storedMetadata,
      vectorId: selectVectorId({
        workspace: args.workspace,
        docId: first.row.docId,
        imageKey,
        existingVectorId: indexed.vectorIds.get(imageKey),
      }),
    });
  }

  const beforeAll = await collection.get({ include: [] });
  const preexistingVectorIds = new Set(beforeAll.ids);
  const newlyCreatedVectorIds = pending
    .map(({ vectorId }) => vectorId)
    .filter((vectorId) => !preexistingVectorIds.has(vectorId));
  const priorProgress = readBackfillProgress(storageRoot, targetDocumentId) || {};
  const embeddingProgress = await processEmbeddingBatches({
    items: pending,
    batchSize: EMBEDDING_BATCH_SIZE,
    embedBatch: embedDescriptionsNoRetry,
    upsertBatch: async (batch, vectors) =>
      collection.upsert({
        ids: batch.map((item) => item.vectorId),
        embeddings: vectors,
        metadatas: batch.map((item) => item.metadata),
        documents: batch.map((item) => item.description),
      }),
    onBatchComplete: async (progress) =>
      writeBackfillProgress(storageRoot, targetDocumentId, {
        ...priorProgress,
        phase: "embedding",
        ...progress,
      }),
  });

  const canonicalMappings = [];
  for (const [imageKey, occurrence] of occurrences) {
    if (!plan.descriptions.has(imageKey)) continue;
    const row = occurrence?.rows?.[0]?.row;
    const pendingItem = pending.find((item) => item.imageKey === imageKey);
    const vectorId = pendingItem?.vectorId || indexed.vectorIds.get(imageKey);
    if (!row || !vectorId) throw new Error(`vector_mapping_missing:${imageKey}`);
    canonicalMappings.push({ docId: row.docId, vectorId });
  }
  try {
    await prisma.$transaction([
      prisma.document_vectors.deleteMany({
        where: { vectorId: { in: canonicalMappings.map(({ vectorId }) => vectorId) } },
      }),
      ...canonicalMappings.map((mapping) =>
        prisma.document_vectors.create({ data: mapping })
      ),
    ]);
  } catch (error) {
    if (newlyCreatedVectorIds.length > 0)
      await collection.delete({ ids: newlyCreatedVectorIds }).catch(() => null);
    throw error;
  }

  const verified = await indexedImageDescriptions(collection, targetDocumentId);
  if (
    verified.vectorIds.size < plan.descriptions.size ||
    verified.descriptions.size < plan.descriptions.size
  )
    throw new Error("image_vector_postcheck_count_mismatch");
  for (const [imageKey, description] of plan.descriptions) {
    if (verified.descriptions.get(imageKey) !== description)
      throw new Error(`image_vector_postcheck_text_mismatch:${imageKey}`);
  }
  const mappingRows = await prisma.document_vectors.findMany({
    where: { vectorId: { in: canonicalMappings.map(({ vectorId }) => vectorId) } },
    select: { docId: true, vectorId: true },
  });
  if (mappingRows.length !== canonicalMappings.length)
    throw new Error("image_vector_mapping_count_mismatch");
  const expectedMappings = new Map(
    canonicalMappings.map(({ docId, vectorId }) => [vectorId, docId])
  );
  if (
    mappingRows.some(
      ({ docId, vectorId }) => expectedMappings.get(vectorId) !== docId
    )
  )
    throw new Error("image_vector_mapping_target_mismatch");

  const bodyAfter = await bodyVectorSnapshot(collection);
  if (bodyAfter.count !== bodyBefore.count || bodyAfter.hash !== bodyBefore.hash)
    throw new Error("body_vectors_changed");

  console.log(
    JSON.stringify({
      applied: true,
      descriptionCalls,
      descriptionSuccess,
      emptyDescriptions,
      descriptionFailures,
      cachedDescriptions: cached.descriptions.size,
      completedBatches,
      embeddingBatches: embeddingProgress.completedBatches,
      embeddingRequests: embeddingProgress.embeddingRequests,
      vectorsUpserted: embeddingProgress.vectorsUpserted,
      vectorsAdded: newlyCreatedVectorIds.length,
      vectorsUpdated: pending.length - newlyCreatedVectorIds.length,
      documentsUpdated,
      targetImages: verified.vectorIds.size,
      bodyVectors: bodyAfter.count,
      bodyHash: bodyAfter.hash,
    })
  );
}

if (require.main === module) {
  main()
    .catch((error) => {
      console.error(JSON.stringify({ error: error.message }));
      process.exitCode = 1;
    })
    .finally(async () => {
      try {
        const prisma = require("../utils/prisma");
        await prisma.$disconnect();
      } catch {}
    });
}

module.exports = {
  collectImageOccurrences,
  selectSingleImageDocumentId,
  planImageBackfill,
  applyDescriptionsToDocumentData,
  parseArgs,
  assertBackfillScope,
  assertApprovedBackfillCeilings,
  collectIndexedImageDescriptions,
  readCachedDescriptionState,
  readBackfillProgress,
  writeBackfillProgress,
  splitIntoBatches,
  selectVectorId,
  processEmbeddingBatches,
  summarizeVectorChanges,
};
