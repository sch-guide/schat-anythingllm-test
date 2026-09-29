const { ChromaClient } = require("chromadb");
const { TextSplitter } = require("../../TextSplitter");
const { SystemSettings } = require("../../../models/systemSettings");
const { storeVectorResult, cachedVectorInformation } = require("../../files");
const { v4: uuidv4 } = require("uuid");
const { toChunks, getEmbeddingEngineSelection } = require("../../helpers");
const { parseAuthHeader } = require("../../http");
const { sourceIdentifier } = require("../../chats");
const { VectorDatabase } = require("../base");
const {
  rankByBm25,
  fuseGeminiAndBm25,
  addHeadingContinuationCandidates,
  addProcedureWorkflowCandidates,
  evidenceResultLimit,
  limitImageDescriptionCandidates,
  isImageRequest,
  addSamePageImageCandidates,
} = require("./schatBm25");
const { buildImageDescriptionChunks } = require("./imageDescriptionChunks");
const { attachVectorIdentity } = require("./sourceIdentity");
const searchCache = require("./searchCache");
const {
  getActiveGroups: getActiveSynonymGroups,
  synonymsVersion,
} = require("../../synonyms");
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
    relatedImageQueryVector = queryVector,
    relatedImageQueryText = queryText,
    includeRelatedImages = true,
    similarityThreshold = 0.25,
    topN = 4,
    filterIdentifiers = [],
    // Optional speed-ups from performSimilaritySearch (results are identical):
    // a cached corpus and a BM25 ranking started while the query was embedded.
    collection: providedCollection = null,
    corpus = null,
    bm25RankedPromise = null,
    // Active synonym groups (동의어 사전) for BM25 word matching only.
    synonymGroups = [],
  }) {
    const collection =
      providedCollection ||
      (await client.getCollection({
        name: this.normalize(namespace),
      }));
    const candidateLimit = Math.max(topN * 4, 20);
    const response = await collection.query({
      queryEmbeddings: queryVector,
      nResults: candidateLimit,
    });

    const relatedImageResponse = includeRelatedImages
      ? relatedImageQueryText === queryText
        ? response
        : await collection.query({
            queryEmbeddings: relatedImageQueryVector,
            nResults: candidateLimit,
          })
      : null;

    const rankedFromResponse = (queryResponse) => {
      const ranked = [];
      queryResponse.ids[0].forEach((id, i) => {
        if (!isEmployeeSearchDocument(queryResponse.metadatas[0][i])) return;
        const similarity = this.distanceToSimilarity(
          queryResponse.distances[0][i]
        );
        if (similarity < similarityThreshold) return;
        if (
          filterIdentifiers.includes(
            sourceIdentifier(queryResponse.metadatas[0][i])
          )
        ) {
          this.logger(
            "A source was filtered from context as it's parent document is pinned."
          );
          return;
        }
        ranked.push({
          id,
          text: queryResponse.documents[0][i],
          metadata: queryResponse.metadatas[0][i],
          vectorScore: similarity,
          corpusPosition: i,
        });
      });
      return ranked;
    };
    const vectorRanked = rankedFromResponse(response);
    const relatedImageVectorRanked = includeRelatedImages
      ? rankedFromResponse(relatedImageResponse)
      : [];

    // Keep the same evidence threshold even if the BM25 supplement becomes
    // unavailable. A keyword-side failure must not turn weak vector matches
    // into employee-visible evidence.
    let fused = fuseGeminiAndBm25(vectorRanked, [], {
      topN,
      vectorWeight: 0.75,
      bm25Weight: 0.25,
      queryText,
      maxImageResults: 1,
    });
    let relatedImageSources = includeRelatedImages
      ? fuseGeminiAndBm25(relatedImageVectorRanked, [], {
          topN: candidateLimit,
          vectorWeight: 0.75,
          bm25Weight: 0.25,
          queryText: relatedImageQueryText,
          maxImageResults: 3,
        })
          .filter(
            (candidate) =>
              candidate?.metadata?.content_type === "image_description"
          )
          .map((candidate) => ({
            ...candidate.metadata,
            id: candidate.id,
            text: candidate.text,
          }))
      : [];
    try {
      const loaded =
        corpus || (await searchCache.loadCorpus(collection, namespace));
      const corpusDocuments = this.corpusDocuments(loaded, filterIdentifiers);
      const bm25Ranked = bm25RankedPromise
        ? await bm25RankedPromise
        : rankByBm25(queryText, corpusDocuments, { synonymGroups }).slice(
            0,
            candidateLimit
          );
      const relatedImageBm25Ranked = includeRelatedImages
        ? relatedImageQueryText === queryText
          ? bm25Ranked
          : rankByBm25(relatedImageQueryText, corpusDocuments, {
              synonymGroups,
            }).slice(
              0,
              candidateLimit
            )
        : [];
      fused = fuseGeminiAndBm25(vectorRanked, bm25Ranked, {
        topN,
        vectorWeight: 0.75,
        bm25Weight: 0.25,
        queryText,
        maxImageResults: 1,
      });
      relatedImageSources = includeRelatedImages
        ? fuseGeminiAndBm25(
            relatedImageVectorRanked,
            relatedImageBm25Ranked,
            {
              topN: candidateLimit,
              vectorWeight: 0.75,
              bm25Weight: 0.25,
              queryText: relatedImageQueryText,
              maxImageResults: 3,
            }
          )
            .filter(
              (candidate) =>
                candidate?.metadata?.content_type === "image_description"
            )
            .map((candidate) => ({
              ...candidate.metadata,
              id: candidate.id,
              text: candidate.text,
            }))
        : [];
      const evidenceTopN = evidenceResultLimit(queryText, topN);
      fused = addHeadingContinuationCandidates(fused, corpusDocuments, {
        queryText,
        topN: evidenceTopN,
      });
      fused = addProcedureWorkflowCandidates(fused, corpusDocuments, {
        queryText,
        topN: evidenceTopN,
      });
      fused = limitImageDescriptionCandidates(fused, {
        maxImageResults: 1,
      });
      if (includeRelatedImages && isImageRequest(relatedImageQueryText))
        relatedImageSources = addSamePageImageCandidates(relatedImageSources, {
          evidence: fused,
          candidates: [...relatedImageVectorRanked, ...relatedImageBm25Ranked],
          corpus: corpusDocuments,
          queryText: relatedImageQueryText,
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

    fused = limitImageDescriptionCandidates(fused, {
      maxImageResults: 1,
    });

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
      relatedImageSources,
    };
  }

  /**
   * Employee-searchable chunks for BM25. The same array is reused for the
   * same corpus version and filter so the BM25 token index can be reused.
   */
  corpusDocuments(loaded, filterIdentifiers = []) {
    const filterKey = JSON.stringify([...filterIdentifiers].sort());
    return searchCache.corpusDocumentsFor(loaded, filterKey, (stored) =>
      stored.ids
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
        )
    );
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
    searchCache.invalidate();
    await client.deleteCollection({ name: this.normalize(namespace) });
    searchCache.invalidate();
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
      const {
        pageContent = "",
        docId,
        pdf_images: pdfImages = [],
        ...metadata
      } = documentData;
      const imageDescriptionChunks = buildImageDescriptionChunks({
        images: pdfImages,
        metadata,
      });
      if ((!pageContent || pageContent.length === 0) && imageDescriptionChunks.length === 0)
        return false;

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
      const chunkPolicy = searchableChunkMetadata(bodyMetadata);
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
      const textChunks = pageContent
        ? await textSplitter.splitText(pageContent)
        : [];

      this.logger("Snippets created from document:", textChunks.length);
      const documentVectors = [];
      const vectors = [];
      const vectorValues = textChunks.length
        ? await EmbedderEngine.embedChunks(textChunks)
        : [];
      const submission = {
        ids: [],
        embeddings: [],
        metadatas: [],
        documents: [],
      };

      if (!!vectorValues && vectorValues.length > 0) {
        for (const [i, vector] of vectorValues.entries()) {
          const storedChunkMetadata = searchableChunkMetadata(
            bodyMetadata,
            textChunks[i]
          ).metadata;
          const vectorRecord = {
            id: uuidv4(),
            values: vector,
            // [DO NOT REMOVE]
            // LangChain will be unable to find your text if you embed manually and dont include the `text` key.
            // https://github.com/hwchase17/langchainjs/blob/2def486af734c0ca87285a48f1a04c057ab74bdf/langchain/src/vectorstores/pinecone.ts#L64
            metadata: { ...storedChunkMetadata, text: textChunks[i] },
          };

          submission.ids.push(vectorRecord.id);
          submission.embeddings.push(vectorRecord.values);
          submission.metadatas.push(storedChunkMetadata);
          submission.documents.push(textChunks[i]);

          vectors.push(vectorRecord);
          documentVectors.push({ docId, vectorId: vectorRecord.id });
        }
      } else if (textChunks.length > 0) {
        throw new Error(
          "Could not embed document chunks! This document will not be recorded."
        );
      }

      if (imageDescriptionChunks.length > 0) {
        try {
          const imageVectors = await EmbedderEngine.embedChunks(
            imageDescriptionChunks.map((chunk) => chunk.text)
          );
          if (Array.isArray(imageVectors)) {
            for (const [index, vector] of imageVectors.entries()) {
              const imageChunk = imageDescriptionChunks[index];
              if (!imageChunk || !vector) continue;
              const id = uuidv4();
              const storedMetadata = searchableChunkMetadata(
                imageChunk.metadata,
                imageChunk.text
              ).metadata;
              submission.ids.push(id);
              submission.embeddings.push(vector);
              submission.metadatas.push(storedMetadata);
              submission.documents.push(imageChunk.text);
              vectors.push({
                id,
                values: vector,
                metadata: { ...storedMetadata, text: imageChunk.text },
              });
              documentVectors.push({ docId, vectorId: id });
            }
          }
        } catch (error) {
          this.logger(
            "Image description embedding skipped; body vectors remain available.",
            error.message
          );
        }
      }

      if (vectors.length === 0) {
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
    relatedImageQueryText = input,
    includeRelatedImages = true,
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

    // Speed-up path only: if the collection or corpus can't be loaded here,
    // similarityResponse does it itself exactly as before (and falls back to
    // vector-only results when BM25 data is unavailable).
    let collection = null;
    try {
      collection = await client.getCollection({
        name: this.normalize(namespace),
      });
    } catch {
      collection = null;
    }
    // Start the query embedding (Gemini) and the corpus load + BM25 ranking
    // at the same time; they don't depend on each other.
    const queryVectorPromise = searchCache.embedWithCache(LLMConnector, input);
    queryVectorPromise.catch(() => null);
    const corpus = collection
      ? await searchCache.loadCorpus(collection, namespace).catch(() => null)
      : null;
    const synonymGroups = await getActiveSynonymGroups();
    const cacheKey = corpus?.version
      ? searchCache.searchKey([
          namespace,
          corpus.version,
          synonymsVersion(),
          input,
          relatedImageQueryText,
          includeRelatedImages,
          similarityThreshold,
          topN,
          [...filterIdentifiers].sort(),
        ])
      : null;
    const cached = cacheKey ? searchCache.getSearch(cacheKey) : null;
    if (cached) return cached;

    const candidateLimit = Math.max(topN * 4, 20);
    // setImmediate lets the embedding request go out before BM25 uses the CPU.
    const bm25RankedPromise = corpus
      ? new Promise((resolve) => setImmediate(resolve)).then(() =>
          rankByBm25(input, this.corpusDocuments(corpus, filterIdentifiers), {
            synonymGroups,
          }).slice(0, candidateLimit)
        )
      : null;
    bm25RankedPromise?.catch(() => null);
    const queryVector = await queryVectorPromise;
    const relatedImageQueryVector = includeRelatedImages
      ? relatedImageQueryText === input
        ? queryVector
        : await searchCache.embedWithCache(LLMConnector, relatedImageQueryText)
      : queryVector;
    const { contextTexts, sourceDocuments, scores, relatedImageSources } =
      await this.similarityResponse({
        client,
        namespace,
        queryVector,
        queryText: input,
        relatedImageQueryVector,
        relatedImageQueryText,
        includeRelatedImages,
        similarityThreshold,
        topN,
        filterIdentifiers,
        collection,
        corpus,
        bm25RankedPromise,
        synonymGroups,
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

    const result = {
      contextTexts,
      sources: this.curateSources(sources),
      relatedImageSources: relatedImageSources || [],
      message: false,
    };
    if (cacheKey) searchCache.setSearch(cacheKey, result);
    return result;
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
    searchCache.invalidate();
    await client.reset();
    searchCache.invalidate();
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
    // Invalidate before and after so no search can cache a half-written state.
    searchCache.invalidate();
    try {
      await collection.add(submissions);
    } finally {
      searchCache.invalidate();
    }
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
    searchCache.invalidate();
    try {
      await collection.delete({ ids: vectorIds });
    } finally {
      searchCache.invalidate();
    }
    return true;
  }
}

module.exports.Chroma = Chroma;
