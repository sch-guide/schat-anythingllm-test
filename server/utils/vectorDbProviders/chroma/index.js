const { ChromaClient } = require("chromadb");
const { TextSplitter } = require("../../TextSplitter");
const { SystemSettings } = require("../../../models/systemSettings");
const { storeVectorResult, cachedVectorInformation } = require("../../files");
const { v4: uuidv4 } = require("uuid");
const { toChunks, getEmbeddingEngineSelection } = require("../../helpers");
const { parseAuthHeader } = require("../../http");
const { sourceIdentifier } = require("../../chats");
const { VectorDatabase } = require("../base");
const { rankByBm25, fuseGeminiAndBm25 } = require("./schatBm25");
const { attachVectorIdentity } = require("./sourceIdentity");
const {
  SCHAT_CHUNK_SIZE,
  SCHAT_CHUNK_OVERLAP,
  SCHAT_CHUNK_POLICY_VERSION,
  isEmployeeSearchDocument,
  searchableChunkMetadata,
} = require("./schatPolicy");
const COLLECTION_REGEX = new RegExp(
  /^(?!\d+\.\d+\.\d+\.\d+$)(?!.*\.\.)(?=^[a-zA-Z0-9][a-zA-Z0-9_-]{1,61}[a-zA-Z0-9]$).{3,63}$/
);

class Chroma extends VectorDatabase {
  constructor() {
    super();
  }

  get name() {
    return "Chroma";
  }

  // Chroma DB has specific requirements for collection names:
  // (1) Must contain 3-63 characters
  // (2) Must start and end with an alphanumeric character
  // (3) Can only contain alphanumeric characters, underscores, or hyphens
  // (4) Cannot contain two consecutive periods (..)
  // (5) Cannot be a valid IPv4 address
  // We need to enforce these rules by normalizing the collection names
  // before communicating with the Chroma DB.
  normalize(inputString) {
    if (COLLECTION_REGEX.test(inputString)) return inputString;
    let normalized = inputString.replace(/[^a-zA-Z0-9_-]/g, "-");

    // Replace consecutive periods with a single period (if any)
    normalized = normalized.replace(/\.\.+/g, ".");

    // Ensure the name doesn't start with a non-alphanumeric character
    if (normalized[0] && !/^[a-zA-Z0-9]$/.test(normalized[0])) {
      normalized = "anythingllm-" + normalized.slice(1);
    }

    // Ensure the name doesn't end with a non-alphanumeric character
    if (
      normalized[normalized.length - 1] &&
      !/^[a-zA-Z0-9]$/.test(normalized[normalized.length - 1])
    ) {
      normalized = normalized.slice(0, -1);
    }

    // Ensure the length is between 3 and 63 characters
    if (normalized.length < 3) {
      normalized = `anythingllm-${normalized}`;
    } else if (normalized.length > 63) {
      // Recheck the norm'd name if sliced since its ending can still be invalid.
      normalized = this.normalize(normalized.slice(0, 63));
    }

    // Ensure the name is not an IPv4 address
    if (/^\d+\.\d+\.\d+\.\d+$/.test(normalized)) {
      normalized = "-" + normalized.slice(1);
    }

    return normalized;
  }

  async connect() {
    if (process.env.VECTOR_DB !== "chroma")
      throw new Error("Chroma::Invalid ENV settings");

    const client = new ChromaClient({
      path: process.env.CHROMA_ENDPOINT, // if not set will fallback to localhost:8000
      ...(!!process.env.CHROMA_API_HEADER && !!process.env.CHROMA_API_KEY
        ? {
            fetchOptions: {
              headers: parseAuthHeader(
                process.env.CHROMA_API_HEADER || "X-Api-Key",
                process.env.CHROMA_API_KEY
              ),
            },
          }
        : {}),
    });

    const isAlive = await client.heartbeat();
    if (!isAlive)
      throw new Error(
        "ChromaDB::Invalid Heartbeat received - is the instance online?"
      );
    return { client };
  }

  async heartbeat() {
    const { client } = await this.connect();
    return { heartbeat: await client.heartbeat() };
  }

  async totalVectors() {
    const { client } = await this.connect();
    const collections = await client.listCollections();
    var totalVectors = 0;
    for (const collectionObj of collections) {
      const collection = await client
        .getCollection({ name: collectionObj.name })
        .catch(() => null);
      if (!collection) continue;
      totalVectors += await collection.count();
    }
    return totalVectors;
  }

  /**
   * Converts a cosine distance ([0, 2]: 0 identical, 1 orthogonal, 2 opposite)
   * to a similarity score in [0, 1]. Distances at or past orthogonal floor at 0
   * so unrelated chunks can never clear a similarity threshold.
   * @param {number|null} distance - Cosine distance from the vector search.
   * @returns {number} Similarity score in [0, 1].
   */
  distanceToSimilarity(distance = null) {
    if (distance === null || typeof distance !== "number") return 0.0;
    if (distance >= 1.0) return 0;
    if (distance < 0) return 1 - Math.abs(distance);
    return 1 - distance;
  }

  async namespaceCount(_namespace = null) {
    const { client } = await this.connect();
    const namespace = await this.namespace(client, this.normalize(_namespace));
    return namespace?.vectorCount || 0;
  }

  async similarityResponse({
    client,
    namespace,
    queryVector,
    queryText = "",
    similarityThreshold = 0.25,
    topN = 4,
    filterIdentifiers = [],
  }) {
    const collection = await client.getCollection({
      name: this.normalize(namespace),
    });
    const candidateLimit = Math.max(topN * 4, 20);
    const response = await collection.query({
      queryEmbeddings: queryVector,
      nResults: candidateLimit,
    });

    const vectorRanked = [];
    response.ids[0].forEach((id, i) => {
      if (!isEmployeeSearchDocument(response.metadatas[0][i])) return;
      const similarity = this.distanceToSimilarity(response.distances[0][i]);
      if (similarity < similarityThreshold) return;
      if (
        filterIdentifiers.includes(sourceIdentifier(response.metadatas[0][i]))
      ) {
        this.logger(
          "A source was filtered from context as it's parent document is pinned."
        );
        return;
      }
      vectorRanked.push({
        id,
        text: response.documents[0][i],
        metadata: response.metadatas[0][i],
        vectorScore: similarity,
        corpusPosition: i,
      });
    });

    let fused = vectorRanked.slice(0, topN);
    try {
      const stored = await collection.get({
        include: ["documents", "metadatas"],
      });
      const corpusDocuments = stored.ids
        .map((id, corpusPosition) => ({
          id,
          text: stored.documents[corpusPosition],
          metadata: stored.metadatas[corpusPosition],
          corpusPosition,
        }))
        .filter(
          (document) =>
            document.text &&
            isEmployeeSearchDocument(document.metadata) &&
            !filterIdentifiers.includes(sourceIdentifier(document.metadata))
        );
      const bm25Ranked = rankByBm25(queryText, corpusDocuments).slice(
        0,
        candidateLimit
      );
      fused = fuseGeminiAndBm25(vectorRanked, bm25Ranked, {
        topN,
        vectorWeight: 0.75,
        bm25Weight: 0.25,
      });
      this.logger(
        "SCHAT hybrid retrieval summary",
        JSON.stringify({
          vectorCandidateCount: vectorRanked.length,
          bm25CandidateCount: bm25Ranked.length,
          selectedCount: fused.length,
          selectedScores: fused.map((candidate) => ({
            vectorRank: candidate.retrieval?.vectorRank ?? null,
            vectorScore: candidate.retrieval?.vectorScore ?? null,
            bm25Rank: candidate.retrieval?.bm25Rank ?? null,
            bm25Score: candidate.retrieval?.bm25Score ?? null,
            bm25Coverage: candidate.retrieval?.bm25Coverage ?? 0,
            fusionScore: candidate.retrieval?.fusionScore ?? 0,
          })),
        })
      );
    } catch (error) {
      this.logger(
        "BM25 supplement unavailable; returning Gemini/Chroma results only.",
        error.message
      );
    }

    return {
      contextTexts: fused.map((candidate) => candidate.text),
      sourceDocuments: fused.map((candidate) => ({
        ...candidate.metadata,
        id: candidate.id,
      })),
      scores: fused.map(
        (candidate) =>
          candidate.retrieval?.fusionScore ?? candidate.vectorScore ?? 0
      ),
    };
  }

  async namespace(client, namespace = null) {
    if (!namespace) throw new Error("No namespace value provided.");
    const collection = await client
      .getCollection({ name: this.normalize(namespace) })
      .catch(() => null);
    if (!collection) return null;

    return {
      ...collection,
      vectorCount: await collection.count(),
    };
  }

  async hasNamespace(namespace = null) {
    if (!namespace) return false;
    const { client } = await this.connect();
    return await this.namespaceExists(client, this.normalize(namespace));
  }

  async namespaceExists(client, namespace = null) {
    if (!namespace) throw new Error("No namespace value provided.");
    const collection = await client
      .getCollection({ name: this.normalize(namespace) })
      .catch((e) => {
        this.logger("namespaceExists", e.message);
        return null;
      });
    return !!collection;
  }

  async deleteVectorsInNamespace(client, namespace = null) {
    await client.deleteCollection({ name: this.normalize(namespace) });
    return true;
  }

  async addDocumentToNamespace(
    namespace,
    documentData = {},
    fullFilePath = null,
    skipCache = false
  ) {
    const { DocumentVectors } = require("../../../models/vectors");
    try {
      const { pageContent, docId, ...metadata } = documentData;
      if (!pageContent || pageContent.length == 0) return false;

      this.logger("Adding new vectorized document into namespace", namespace);
      // Include the clinical chunking policy in the cache key. This keeps the
      // cache useful without silently restoring legacy 8,192-character chunks.
      const cacheKey = fullFilePath
        ? `${fullFilePath}::${SCHAT_CHUNK_POLICY_VERSION}`
        : null;
      if (!skipCache) {
        const cacheResult = await cachedVectorInformation(cacheKey);
        if (cacheResult.exists) {
          const { client } = await this.connect();
          const collection = await client.getOrCreateCollection({
            name: this.normalize(namespace),
            // returns [-1, 1] unit vector
            metadata: { "hnsw:space": "cosine" },
          });
          const { chunks } = cacheResult;
          const documentVectors = [];

          for (const chunk of chunks) {
            const submission = {
              ids: [],
              embeddings: [],
              metadatas: [],
              documents: [],
            };

            // Before sending to Chroma and saving the records to our db
            // we need to assign the id of each chunk that is stored in the cached file.
            chunk.forEach((chunk) => {
              const id = uuidv4();
              const { id: _id, ...metadata } = chunk.metadata;
              documentVectors.push({ docId, vectorId: id });
              submission.ids.push(id);
              submission.embeddings.push(chunk.values);
              submission.metadatas.push(metadata);
              submission.documents.push(metadata.text);
            });

            await this.smartAdd(collection, submission);
          }

          await DocumentVectors.bulkInsert(documentVectors);
          return { vectorized: true, error: null };
        }
      }

      // If we are here then we are going to embed and store a novel document.
      // We have to do this manually as opposed to using LangChains `Chroma.fromDocuments`
      // because we then cannot atomically control our namespace to granularly find/remove documents
      // from vectordb.
      const EmbedderEngine = getEmbeddingEngineSelection();
      const chunkPolicy = searchableChunkMetadata(metadata);
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
      const textSplitter = new TextSplitter({
        chunkSize,
        chunkOverlap: Math.min(requestedOverlap, Math.max(0, chunkSize - 1)),
        chunkHeaderMeta: chunkPolicy.chunkHeaderMeta,
        chunkPrefix: EmbedderEngine?.embeddingPrefix,
      });
      const textChunks = await textSplitter.splitText(pageContent);

      this.logger("Snippets created from document:", textChunks.length);
      const documentVectors = [];
      const vectors = [];
      const vectorValues = await EmbedderEngine.embedChunks(textChunks);
      const submission = {
        ids: [],
        embeddings: [],
        metadatas: [],
        documents: [],
      };

      if (!!vectorValues && vectorValues.length > 0) {
        for (const [i, vector] of vectorValues.entries()) {
          const vectorRecord = {
            id: uuidv4(),
            values: vector,
            // [DO NOT REMOVE]
            // LangChain will be unable to find your text if you embed manually and dont include the `text` key.
            // https://github.com/hwchase17/langchainjs/blob/2def486af734c0ca87285a48f1a04c057ab74bdf/langchain/src/vectorstores/pinecone.ts#L64
            metadata: { ...metadata, text: textChunks[i] },
          };

          submission.ids.push(vectorRecord.id);
          submission.embeddings.push(vectorRecord.values);
          submission.metadatas.push(metadata);
          submission.documents.push(textChunks[i]);

          vectors.push(vectorRecord);
          documentVectors.push({ docId, vectorId: vectorRecord.id });
        }
      } else {
        throw new Error(
          "Could not embed document chunks! This document will not be recorded."
        );
      }

      const { client } = await this.connect();
      const collection = await client.getOrCreateCollection({
        name: this.normalize(namespace),
        metadata: { "hnsw:space": "cosine" },
      });

      if (vectors.length > 0) {
        const chunks = [];
        this.logger("Inserting vectorized chunks into Chroma collection.");
        for (const chunk of toChunks(vectors, 500)) chunks.push(chunk);

        try {
          await this.smartAdd(collection, submission);
          this.logger(
            `Successfully added ${submission.ids.length} vectors to collection ${this.normalize(namespace)}`
          );
        } catch (error) {
          this.logger("Error adding to ChromaDB:", error);
          throw new Error(`Error embedding into ChromaDB: ${error.message}`);
        }

        await storeVectorResult(chunks, cacheKey);
      }

      await DocumentVectors.bulkInsert(documentVectors);
      return { vectorized: true, error: null };
    } catch (e) {
      this.logger("addDocumentToNamespace", e.message);
      return { vectorized: false, error: e.message };
    }
  }

  async deleteDocumentFromNamespace(namespace, docId) {
    const { DocumentVectors } = require("../../../models/vectors");
    const { client } = await this.connect();
    if (!(await this.namespaceExists(client, namespace))) return;
    const collection = await client.getCollection({
      name: this.normalize(namespace),
    });

    const knownDocuments = await DocumentVectors.where({ docId });
    if (knownDocuments.length === 0) return;

    const vectorIds = knownDocuments.map((doc) => doc.vectorId);
    await this.smartDelete(collection, vectorIds);

    const indexes = knownDocuments.map((doc) => doc.id);
    await DocumentVectors.deleteIds(indexes);
    return true;
  }

  async performSimilaritySearch({
    namespace = null,
    input = "",
    LLMConnector = null,
    similarityThreshold = 0.25,
    topN = 4,
    filterIdentifiers = [],
  }) {
    if (!namespace || !input || !LLMConnector)
      throw new Error("Invalid request to performSimilaritySearch.");

    const { client } = await this.connect();
    if (!(await this.namespaceExists(client, this.normalize(namespace)))) {
      return {
        contextTexts: [],
        sources: [],
        message: "Invalid query - no documents found for workspace!",
      };
    }

    const queryVector = await LLMConnector.embedTextInput(input);
    const { contextTexts, sourceDocuments, scores } =
      await this.similarityResponse({
        client,
        namespace,
        queryVector,
        queryText: input,
        similarityThreshold,
        topN,
        filterIdentifiers,
      });

    const { DocumentVectors } = require("../../../models/vectors");
    const vectorIds = sourceDocuments
      .map((metadata) => metadata.id)
      .filter(Boolean);
    const vectorMappings = vectorIds.length
      ? await DocumentVectors.where({ vectorId: { in: vectorIds } })
      : [];
    const identifiedSources = attachVectorIdentity(
      sourceDocuments,
      vectorMappings
    );
    const sources = identifiedSources.map((metadata, i) => ({
      metadata: {
        ...metadata,
        text: contextTexts[i],
        score: scores?.[i] || null,
      },
    }));

    return {
      contextTexts,
      sources: this.curateSources(sources),
      message: false,
    };
  }

  async "namespace-stats"(reqBody = {}) {
    const { namespace = null } = reqBody;
    if (!namespace) throw new Error("namespace required");
    const { client } = await this.connect();
    if (!(await this.namespaceExists(client, this.normalize(namespace))))
      throw new Error("Namespace by that name does not exist.");
    const stats = await this.namespace(client, this.normalize(namespace));
    return stats
      ? stats
      : { message: "No stats were able to be fetched from DB for namespace" };
  }

  async "delete-namespace"(reqBody = {}) {
    const { namespace = null } = reqBody;
    const { client } = await this.connect();
    if (!(await this.namespaceExists(client, this.normalize(namespace))))
      throw new Error("Namespace by that name does not exist.");

    const details = await this.namespace(client, this.normalize(namespace));
    await this.deleteVectorsInNamespace(client, this.normalize(namespace));
    return {
      message: `Namespace ${namespace} was deleted along with ${details?.vectorCount} vectors.`,
    };
  }

  async reset() {
    const { client } = await this.connect();
    await client.reset();
    return { reset: true };
  }

  curateSources(sources = []) {
    const documents = [];
    for (const source of sources) {
      const { metadata = {} } = source;
      if (Object.keys(metadata).length > 0) {
        documents.push({
          ...metadata,
          ...(source.hasOwnProperty("pageContent")
            ? { text: source.pageContent }
            : {}),
        });
      }
    }

    return documents;
  }

  /**
   * This method is a wrapper around the ChromaCollection.add method.
   * It will return true if the add was successful, false otherwise.
   * For local deployments, this will be the same as calling the add method directly since there are no limitations.
   * @param {import("chromadb").Collection} collection
   * @param {{ids: string[], embeddings: number[], metadatas: Record<string, any>[], documents: string[]}[]} submissions
   * @returns {Promise<boolean>} True if the add was successful, false otherwise.
   */
  async smartAdd(collection, submissions) {
    await collection.add(submissions);
    return true;
  }

  /**
   * This method is a wrapper around the ChromaCollection.delete method.
   * It will return the result of the delete method directly.
   * For local deployments, this will be the same as calling the delete method directly since there are no limitations.
   * @param {import("chromadb").Collection} collection
   * @param {string[]} vectorIds
   * @returns {Promise<boolean>} True if the delete was successful, false otherwise.
   */
  async smartDelete(collection, vectorIds) {
    await collection.delete({ ids: vectorIds });
    return true;
  }
}

module.exports.Chroma = Chroma;
