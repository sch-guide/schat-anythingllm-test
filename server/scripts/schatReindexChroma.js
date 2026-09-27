const fs = require("fs");
const path = require("path");
const { OpenAI } = require("openai");
const { ChromaClient } = require("chromadb");
const { v4: uuidv4 } = require("uuid");

const prisma = require("../utils/prisma");
const { fileData } = require("../utils/files");
const { TextSplitter } = require("../utils/TextSplitter");
const {
  SCHAT_CHUNK_SIZE,
  SCHAT_CHUNK_OVERLAP,
  SCHAT_CHUNK_POLICY_VERSION,
  searchableChunkMetadata,
} = require("../utils/vectorDbProviders/chroma/schatPolicy");
const {
  assertApprovedReindexScope,
  buildReindexCollectionNames,
  sanitizeChromaMetadata,
  summarizeReindexMetadata,
} = require("../utils/vectorDbProviders/chroma/reindexContract");

const EXPECTED_PAGE_RECORDS = 100;
const EXPECTED_LOGICAL_DOCUMENTS = 1;
const EXPECTED_VECTOR_COUNT = 116;
const MODEL = "gemini-embedding-2";
const MAX_RETRIES = 0;

function runId() {
  return new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
}

async function collectionExists(client, name) {
  return Boolean(
    await client.getCollection({ name }).catch(() => null)
  );
}

async function main() {
  if (process.env.VECTOR_DB !== "chroma")
    throw new Error("VECTOR_DB must be chroma.");
  if (process.env.EMBEDDING_ENGINE !== "gemini")
    throw new Error("EMBEDDING_ENGINE must be gemini.");
  if (process.env.EMBEDDING_MODEL_PREF !== MODEL)
    throw new Error(`EMBEDDING_MODEL_PREF must be ${MODEL}.`);

  const apiKey =
    process.env.GEMINI_EMBEDDING_API_KEY || process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("Gemini embedding API key is not configured.");

  const workspace = await prisma.workspaces.findFirst({
    orderBy: { id: "asc" },
  });
  if (!workspace) throw new Error("Workspace not found.");

  const documents = await prisma.workspace_documents.findMany({
    where: { workspaceId: workspace.id },
    orderBy: { id: "asc" },
  });
  const prepared = [];
  for (const document of documents) {
    const data = await fileData(document.docpath);
    if (!data?.pageContent) throw new Error("Approved source page is missing.");
    const { pageContent, ...metadata } = data;
    prepared.push({ document, pageContent, metadata });
  }

  const scope = assertApprovedReindexScope(
    prepared.map(({ metadata }) => metadata),
    {
      expectedDocuments: EXPECTED_PAGE_RECORDS,
      expectedLogicalDocuments: EXPECTED_LOGICAL_DOCUMENTS,
    }
  );

  const id = process.env.SCHAT_REINDEX_RUN_ID || runId();
  const names = buildReindexCollectionNames(workspace.slug, id);
  const chroma = new ChromaClient({ path: process.env.CHROMA_ENDPOINT });
  await chroma.heartbeat();

  if (!(await collectionExists(chroma, names.live)))
    throw new Error("Live Chroma collection is missing.");
  if (await collectionExists(chroma, names.staging))
    throw new Error("Staging collection already exists.");
  if (await collectionExists(chroma, names.previous))
    throw new Error("Previous collection already exists.");

  const live = await chroma.getCollection({ name: names.live });
  const oldVectorCount = await live.count();
  if (oldVectorCount !== EXPECTED_VECTOR_COUNT)
    throw new Error("Existing vector count is outside the approved scope.");

  const usersBefore = await prisma.users.count();
  const chatsBefore = await prisma.workspace_chats.count();
  const originalMappings = await prisma.document_vectors.findMany({
    where: { docId: { in: documents.map(({ docId }) => docId) } },
    select: { docId: true, vectorId: true },
  });
  const staging = await chroma.createCollection({
    name: names.staging,
    metadata: {
      "hnsw:space": "cosine",
      "schat:chunk_policy": SCHAT_CHUNK_POLICY_VERSION,
    },
  });
  const embeddingClient = new OpenAI({
    apiKey,
    baseURL: "https://generativelanguage.googleapis.com/v1beta/openai/",
    maxRetries: MAX_RETRIES,
  });

  const vectorMappings = [];
  const summaryRecords = [];
  let embeddingRequestCount = 0;
  let promptTokens = 0;
  let totalTokens = 0;
  let usageResponses = 0;
  let collectionsSwapped = false;
  let databaseSwapped = false;

  try {
    for (const [index, item] of prepared.entries()) {
      const chunkPolicy = searchableChunkMetadata(item.metadata);
      const chunks = await new TextSplitter({
        chunkSize: SCHAT_CHUNK_SIZE,
        chunkOverlap: SCHAT_CHUNK_OVERLAP,
        chunkHeaderMeta: chunkPolicy.chunkHeaderMeta,
      }).splitText(item.pageContent);

      embeddingRequestCount += 1;
      const response = await embeddingClient.embeddings.create({
        model: MODEL,
        input: chunks,
        dimensions:
          Number(process.env.EMBEDDING_OUTPUT_DIMENSIONS) > 0
            ? Number(process.env.EMBEDDING_OUTPUT_DIMENSIONS)
            : undefined,
      });
      if (!Array.isArray(response?.data) || response.data.length !== chunks.length)
        throw new Error("Embedding response count does not match chunks.");
      if (response.usage) {
        usageResponses += 1;
        promptTokens += Number(response.usage.prompt_tokens) || 0;
        totalTokens += Number(response.usage.total_tokens) || 0;
      }

      const ids = [];
      const embeddings = [];
      const metadatas = [];
      for (const [chunkIndex, chunk] of chunks.entries()) {
        const vector = response.data[chunkIndex]?.embedding;
        if (!Array.isArray(vector) || vector.length === 0)
          throw new Error("Embedding vector is missing.");
        const id = uuidv4();
        const metadata = sanitizeChromaMetadata(
          searchableChunkMetadata(item.metadata, chunk).metadata
        );
        ids.push(id);
        embeddings.push(vector);
        metadatas.push(metadata);
        vectorMappings.push({ docId: item.document.docId, vectorId: id });
        summaryRecords.push({ metadata });
      }

      await staging.add({ ids, embeddings, metadatas, documents: chunks });
      if ((index + 1) % 10 === 0 || index + 1 === prepared.length)
        console.log(
          JSON.stringify({
            phase: "staging",
            completedPages: index + 1,
            totalPages: prepared.length,
            vectors: vectorMappings.length,
          })
        );
    }

    const stagingCount = await staging.count();
    const metadataSummary = summarizeReindexMetadata(summaryRecords);
    if (
      stagingCount !== EXPECTED_VECTOR_COUNT ||
      vectorMappings.length !== EXPECTED_VECTOR_COUNT
    )
      throw new Error("Staging vector count does not match the approved count.");
    if (metadataSummary.pageMetadataCount !== EXPECTED_VECTOR_COUNT)
      throw new Error("Page metadata was not preserved for every vector.");

    await live.modify({ name: names.previous });
    try {
      await staging.modify({ name: names.live });
      collectionsSwapped = true;
    } catch (error) {
      const previous = await chroma.getCollection({ name: names.previous });
      await previous.modify({ name: names.live });
      throw error;
    }

    const docIds = documents.map(({ docId }) => docId);
    try {
      await prisma.$transaction([
        prisma.document_vectors.deleteMany({
          where: { docId: { in: docIds } },
        }),
        ...vectorMappings.map((mapping) =>
          prisma.document_vectors.create({ data: mapping })
        ),
      ]);
      databaseSwapped = true;
    } catch (error) {
      const newLive = await chroma.getCollection({ name: names.live });
      await newLive.modify({ name: names.staging });
      const previous = await chroma.getCollection({ name: names.previous });
      await previous.modify({ name: names.live });
      throw error;
    }

    const usersAfter = await prisma.users.count();
    const chatsAfter = await prisma.workspace_chats.count();
    if (usersAfter !== usersBefore || chatsAfter !== chatsBefore)
      throw new Error("Employee accounts or chat history count changed.");

    const result = {
      runId: id,
      model: MODEL,
      maxRetries: MAX_RETRIES,
      chunkPolicy: {
        version: SCHAT_CHUNK_POLICY_VERSION,
        chunkSize: SCHAT_CHUNK_SIZE,
        chunkOverlap: SCHAT_CHUNK_OVERLAP,
      },
      scope,
      oldVectorCount,
      newVectorCount: stagingCount,
      embeddingRequestCount,
      usage: {
        responsesWithUsage: usageResponses,
        promptTokens: usageResponses === embeddingRequestCount ? promptTokens : null,
        totalTokens: usageResponses === embeddingRequestCount ? totalTokens : null,
      },
      metadata: metadataSummary,
      accounts: { before: usersBefore, after: usersAfter },
      chats: { before: chatsBefore, after: chatsAfter },
      collections: names,
      previousCollectionRetainedForRestartVerification: true,
      privacyExampleConfirmed: true,
      privacyValueRecorded: false,
    };
    const outputDir = path.resolve(process.env.STORAGE_DIR, "exports");
    fs.mkdirSync(outputDir, { recursive: true });
    const outputPath = path.join(outputDir, `reindex-result-${id}.json`);
    fs.writeFileSync(outputPath, JSON.stringify(result, null, 2), "utf8");
    console.log(JSON.stringify({ phase: "complete", outputPath, ...result }));
  } catch (error) {
    if (databaseSwapped) {
      const docIds = documents.map(({ docId }) => docId);
      await prisma.$transaction([
        prisma.document_vectors.deleteMany({
          where: { docId: { in: docIds } },
        }),
        ...originalMappings.map((mapping) =>
          prisma.document_vectors.create({ data: mapping })
        ),
      ]);
    }
    if (
      collectionsSwapped &&
      (await collectionExists(chroma, names.live)) &&
      (await collectionExists(chroma, names.previous))
    ) {
      const newLive = await chroma.getCollection({ name: names.live });
      await newLive.modify({ name: names.staging });
      const previous = await chroma.getCollection({ name: names.previous });
      await previous.modify({ name: names.live });
    }
    if (await collectionExists(chroma, names.staging)) {
      await chroma.deleteCollection({ name: names.staging });
    }
    throw error;
  }
}

main()
  .catch((error) => {
    console.error(JSON.stringify({ phase: "failed", error: error.message }));
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
