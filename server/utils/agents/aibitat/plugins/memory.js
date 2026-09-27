const { v4 } = require("uuid");
const {
  getVectorDbClass,
  resolveProviderConnector,
} = require("../../../helpers");
const { Deduplicator } = require("../utils/dedupe");
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

function attachRelatedImageSources(
  sources = [],
  relatedImageSources = [],
  question = ""
) {
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
    if (sourceIndex < 0) continue;

    linkedSources[sourceIndex] = {
      ...linkedSources[sourceIndex],
      image_key: candidate.image_key,
      image_description: candidate.text,
    };
    seenImageKeys.add(image.imageKey);
  }

  return linkedSources;
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

              const ragContext = buildRagContext(sources);
              if (sources.length === 0) {
                this.super.introspect(
                  `${this.caller}: I didn't find anything locally that would help answer this question.`
                );
                return ragContext;
              }

              this.super.introspect(
                `${this.caller}: Found ${contextTexts.length} additional piece of context to help answer this question.`
              );

              this.super.addRagMemorySources?.(
                attachRelatedImageSources(sources, relatedImageSources, query),
                { question: query }
              );
              return ragContext;
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
  memory,
};
