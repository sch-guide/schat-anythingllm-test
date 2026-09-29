const { v4 } = require("uuid");
const {
  getVectorDbClass,
  resolveProviderConnector,
} = require("../../../helpers");
const { Deduplicator } = require("../utils/dedupe");
const {
  isImageRequest,
  queryTokens,
  subjectTerms,
  matchedSubjectTerms,
} = require("../../../vectorDbProviders/chroma/schatBm25");
const {
  buildPublicRagSource,
  buildRagContext,
} = require("../utils/ragSources");

function sourceDocumentIdentity(source = {}) {
  return String(
    source.document_id ||
      source.documentId ||
      source.document_name ||
      source.documentName ||
      source.title ||
      ""
  );
}

function sourcePage(source = {}) {
  return String(source.page ?? "").trim();
}

const MAX_IMAGE_REQUEST_IMAGES = 3;
const IMAGE_SHOWN_NOTICE =
  "(안내) 위 지침서 그림은 답변 아래 출처에 원본 사진으로 함께 표시됩니다. 사진을 보여줄 수 없다고 말하지 말고, 그림 내용은 위 설명 범위 안에서만 답하세요.";
const MAX_IMAGE_PAGE_DISTANCE = 2;

function pageNumber(value = "") {
  const text = String(value ?? "").trim();
  return /^\d+$/.test(text) ? Number(text) : Number.NaN;
}

function nearEvidencePage(sources = [], documentIdentity = "", page = "") {
  const imagePage = pageNumber(page);
  if (!documentIdentity || !Number.isFinite(imagePage)) return false;
  return sources.some((source) => {
    const sourcePageNumber = pageNumber(sourcePage(source));
    return (
      sourceDocumentIdentity(source) === documentIdentity &&
      Number.isFinite(sourcePageNumber) &&
      Math.abs(sourcePageNumber - imagePage) <= MAX_IMAGE_PAGE_DISTANCE
    );
  });
}

function attachRelatedImageSources(
  sources = [],
  relatedImageSources = [],
  question = ""
) {
  const imageRequest = isImageRequest(question);
  const subjects = imageRequest ? subjectTerms(queryTokens(question)) : [];
  let standaloneImages = 0;
  const linkedSources = sources.map((source) => ({ ...source }));
  const seenImageKeys = new Set(
    linkedSources.flatMap((source) =>
      buildPublicRagSource(source, { question }).relatedImages.map(
        (image) => image.imageKey
      )
    )
  );

  for (const candidate of relatedImageSources) {
    const [image] = buildPublicRagSource(candidate, {
      question,
    }).relatedImages;
    if (!image || seenImageKeys.has(image.imageKey)) continue;

    const documentIdentity = sourceDocumentIdentity(candidate);
    const page = sourcePage(candidate);
    const sourceIndex = linkedSources.findIndex(
      (source) =>
        !source.image_key &&
        sourceDocumentIdentity(source) === documentIdentity &&
        sourcePage(source) === page
    );
    if (sourceIndex < 0) {
      // Picture questions only: an image without same-page text evidence is
      // shown as its own source, with its own document and page, when its
      // description holds every subject word of the question and it is
      // printed near (within 2 pages of) the evidence in the same document.
      if (
        !imageRequest ||
        standaloneImages >= MAX_IMAGE_REQUEST_IMAGES ||
        !subjects.length ||
        matchedSubjectTerms(candidate.text, subjects) !== subjects.length ||
        !nearEvidencePage(sources, documentIdentity, page)
      )
        continue;
      linkedSources.push({
        ...candidate,
        content_type: "image_description",
      });
      standaloneImages += 1;
      seenImageKeys.add(image.imageKey);
      continue;
    }

    linkedSources[sourceIndex] = {
      ...linkedSources[sourceIndex],
      image_key: candidate.image_key,
      image_description: candidate.text,
    };
    seenImageKeys.add(image.imageKey);
  }

  return linkedSources;
}

/**
 * Picture questions only: the model also receives the descriptions of the
 * images attached to the answer, so it knows which guideline pictures exist.
 * Other questions get exactly the evidence text they received before.
 */
function imageRequestContextSources(
  sources = [],
  linkedSources = [],
  question = ""
) {
  if (!isImageRequest(question)) return sources;
  // linkedSources = copies of sources (same order) + standalone image sources
  const imageDescriptions = linkedSources
    .map((source, index) => {
      if (index >= sources.length) return source.text;
      return sources[index].image_key ? null : source.image_description;
    })
    .map((description, index) =>
      description
        ? {
            text: `(지침서 그림 설명, p.${linkedSources[index].page ?? "?"}) ${description}`,
          }
        : null
    )
    .filter(Boolean);
  // The Citation list shows these guideline pictures under the answer
  // (decorative images such as the hospital logo are never shown).
  const picturesShown = linkedSources.some(
    (source) =>
      buildPublicRagSource(source, { question }).relatedImages.length > 0
  );
  return [
    ...sources,
    ...imageDescriptions,
    ...(picturesShown ? [{ text: IMAGE_SHOWN_NOTICE }] : []),
  ];
}

const memory = {
  name: "rag-memory",
  startupConfig: {
    params: {},
  },
  plugin: function () {
    return {
      name: this.name,
      setup(aibitat) {
        aibitat.function({
          super: aibitat,
          tracker: new Deduplicator(),
          name: this.name,
          description:
            "Search your local documents and workspace files for relevant information, or store information to long-term memory. Use search to find answers in uploaded documents, embedded files, or previously stored memories. Use store only when explicitly asked to remember or save something.",
          examples: [
            {
              prompt: "Check my files for information about the project",
              call: JSON.stringify({
                action: "search",
                content: "<project information to search for>",
              }),
            },
            {
              prompt: "What do you know about Plato's motives?",
              call: JSON.stringify({
                action: "search",
                content: "What are the facts about Plato's motives?",
              }),
            },
            {
              prompt: "Remember that you are a robot",
              call: JSON.stringify({
                action: "store",
                content: "I am a robot, the user told me that i am.",
              }),
            },
          ],
          parameters: {
            $schema: "http://json-schema.org/draft-07/schema#",
            type: "object",
            properties: {
              action: {
                type: "string",
                enum: ["search", "store"],
                description:
                  "The action we want to take to search for existing similar context or storage of new context.",
              },
              content: {
                type: "string",
                description:
                  "The plain text to search our local documents with or to store in our vector database.",
              },
            },
            additionalProperties: false,
          },
          handler: async function ({ action = "", content = "" }) {
            try {
              const { isDuplicate } = this.tracker.isDuplicate(this.name, {
                action,
                content,
              });
              if (isDuplicate)
                return `This was a duplicated call and it's output will be ignored.`;

              let response = "There was nothing to do.";
              if (action === "search") response = await this.search(content);
              if (action === "store") response = await this.store(content);

              this.tracker.trackRun(this.name, { action, content });
              return response;
            } catch (error) {
              console.log(error);
              return `There was an error while calling the function. ${error.message}`;
            }
          },
          search: async function (query = "") {
            try {
              const workspace = this.super.handlerProps.invocation.workspace;
              const { connector: LLMConnector } =
                await resolveProviderConnector({
                  workspace,
                  prompt: query,
                });
              const vectorDB = getVectorDbClass();
              const {
                contextTexts = [],
                sources = [],
                relatedImageSources = [],
              } =
                await vectorDB.performSimilaritySearch({
                  namespace: workspace.slug,
                  input: query,
                  LLMConnector,
                  topN: workspace?.topN ?? 4,
                  rerank: workspace?.vectorSearchMode === "rerank",
                });

              if (sources.length === 0) {
                this.super.introspect(
                  `${this.caller}: I didn't find anything locally that would help answer this question.`
                );
                return buildRagContext(sources);
              }

              this.super.introspect(
                `${this.caller}: Found ${contextTexts.length} additional piece of context to help answer this question.`
              );

              const linkedSources = attachRelatedImageSources(
                sources,
                relatedImageSources,
                query
              );
              this.super.addRagMemorySources?.(linkedSources, {
                question: query,
              });
              return buildRagContext(
                imageRequestContextSources(sources, linkedSources, query)
              );
            } catch (error) {
              this.super.handlerProps.log(
                `memory.search raised an error. ${error.message}`
              );
              return `An error was raised while searching the vector database. ${error.message}`;
            }
          },
          store: async function (content = "") {
            try {
              const workspace = this.super.handlerProps.invocation.workspace;
              const vectorDB = getVectorDbClass();
              const { error } = await vectorDB.addDocumentToNamespace(
                workspace.slug,
                {
                  docId: v4(),
                  id: v4(),
                  url: "file://embed-via-agent.txt",
                  title: "agent-memory.txt",
                  docAuthor: "@agent",
                  description: "Unknown",
                  docSource: "a text file stored by the workspace agent.",
                  chunkSource: "",
                  published: new Date().toLocaleString(),
                  wordCount: content.split(" ").length,
                  pageContent: content,
                  token_count_estimate: 0,
                },
                null
              );

              if (!!error)
                return "The content was failed to be embedded properly.";
              this.super.introspect(
                `${this.caller}: I saved the content to long-term memory in this workspaces vector database.`
              );
              return "The content given was successfully embedded. There is nothing else to do.";
            } catch (error) {
              this.super.handlerProps.log(
                `memory.store raised an error. ${error.message}`
              );
              return `Let the user know this action was not successful. An error was raised while storing data in the vector database. ${error.message}`;
            }
          },
        });
      },
    };
  },
};

module.exports = {
  attachRelatedImageSources,
  imageRequestContextSources,
  memory,
};
