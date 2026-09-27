const { v4: uuidv4 } = require("uuid");
const { DocumentManager } = require("../DocumentManager");
const { WorkspaceChats } = require("../../models/workspaceChats");
const { WorkspaceParsedFiles } = require("../../models/workspaceParsedFiles");
const { getVectorDbClass, resolveProviderConnector } = require("../helpers");
const { addChatCostToMetrics } = require("../helpers/modelPricing");
const { writeResponseChunk } = require("../helpers/chat/responses");
const { abortConnectorOnClientDisconnect } = require("../helpers/abortSignals");
const { grepAgents } = require("./agents");
const {
  grepCommand,
  VALID_COMMANDS,
  chatPrompt,
  recentChatHistory,
  sourceIdentifier,
} = require("./index");
const { buildChatSearchQueries } = require("./searchQueries");
const { runExpandedBodySearch } = require("./expandedBodySearch");

const VALID_CHAT_MODE = ["automatic", "chat", "query"];

async function streamChatWithWorkspace(
  response,
  workspace,
  message,
  chatMode = "automatic",
  user = null,
  thread = null,
  attachments = []
) {
  const uuid = uuidv4();
  const updatedMessage = await grepCommand(message, user);
  const { bodySearchQuery, relatedImageSearchQuery } = buildChatSearchQueries({
    originalQuestion: message,
    expandedBodyQuery: updatedMessage,
  });
  const safetyEnabled = process.env.SCHAT_SAFETY_ENABLED === "true";
  const safetyGateEnabled =
    process.env.SCHAT_SAFETY_GATE_ENABLED === "true";
  const { attachmentsForChatRecord } = require("../schatSafety/imageAttachment");

  if (safetyEnabled) {
    const {
      imageErrorMessage,
      validateSafetyImageAttachments,
    } = require("../schatSafety/imageAttachment");
    try {
      // Validate before routing, retrieval, or provider access. The returned
      // objects intentionally omit the original filename and other metadata.
      attachments = validateSafetyImageAttachments(attachments);
    } catch (error) {
      writeResponseChunk(response, {
        id: uuid,
        type: "textResponse",
        textResponse: imageErrorMessage(error?.code),
        sources: [],
        close: true,
        error: null,
      });
      return;
    }
  }
  const hasSafetyImage = safetyEnabled && attachments.length === 1;

  if (!hasSafetyImage && Object.keys(VALID_COMMANDS).includes(updatedMessage)) {
    const data = await VALID_COMMANDS[updatedMessage](
      workspace,
      message,
      uuid,
      user,
      thread,
      response,
      attachments
    );
    writeResponseChunk(response, data);
    return;
  }

  // If is agent enabled chat we will exit this flow early.
  const isAgentChat = hasSafetyImage
    ? false
    : await grepAgents({
        uuid,
        response,
        message: updatedMessage,
        user,
        workspace,
        thread,
        attachments,
      });
  if (isAgentChat) return;

  const {
    connector: LLMConnector,
    routingMetadata,
    prefetchedContext,
    error: routerError,
  } = await resolveLLMConnector({
    workspace,
    message: updatedMessage,
    user,
    thread,
    attachments,
  });

  if (routerError) {
    return writeResponseChunk(response, {
      id: uuid,
      type: "abort",
      textResponse: null,
      sources: [],
      close: true,
      error: routerError,
    });
  }

  // Stopping the generation (or closing the tab) should stop the provider
  // generating too, not just stop us reading the response.
  abortConnectorOnClientDisconnect(response, LLMConnector);

  if (routingMetadata?.routedTo?.shouldNotify) {
    writeResponseChunk(response, {
      uuid: `${uuid}:route`,
      type: "modelRouteNotification",
      routedTo: routingMetadata.routedTo,
    });
  }

  const VectorDb = getVectorDbClass();

  const messageLimit = workspace?.openAiHistory || 20;
  const hasVectorizedSpace = await VectorDb.hasNamespace(workspace.slug);
  const embeddingsCount = await VectorDb.namespaceCount(workspace.slug);

  // User is trying to query-mode chat a workspace that has no data in it - so
  // we should exit early as no information can be found under these conditions.
  if (
    (!hasVectorizedSpace || embeddingsCount === 0) &&
    (chatMode === "query" || safetyEnabled)
  ) {
    const textResponse =
      workspace?.queryRefusalResponse ??
      (process.env.SCHAT_SAFETY_ENABLED === "true"
        ? "등록된 병원 지침에서 관련 근거를 확인할 수 없습니다."
        : "There is no relevant information in this workspace to answer your query.");
    writeResponseChunk(response, {
      id: uuid,
      type: "textResponse",
      textResponse,
      sources: [],
      attachments: attachmentsForChatRecord(attachments, safetyEnabled),
      close: true,
      error: null,
    });
    await WorkspaceChats.new({
      workspaceId: workspace.id,
      prompt: message,
      response: {
        text: textResponse,
        sources: [],
        type: chatMode,
        attachments: attachmentsForChatRecord(attachments, safetyEnabled),
      },
      threadId: thread?.id || null,
      include: false,
      user,
    });
    return;
  }

  // If we are here we know that we are in a workspace that is:
  // 1. Chatting in "chat" mode and may or may _not_ have embeddings
  // 2. Chatting in "query" mode and has at least 1 embedding
  let completeText;
  let metrics = {};
  let safety = null;
  let presentation = null;
  let relatedImages = [];
  let contextTexts = [];
  let sources = [];
  let pinnedDocIdentifiers = [];

  // If the router pre-fetched context we can reuse it; otherwise fetch fresh.
  const {
    rawHistory,
    chatHistory,
    pinnedDocs: prefetchedPinnedDocs,
    parsedFiles: prefetchedParsedFiles,
  } = prefetchedContext ??
  (await recentChatHistory({ user, workspace, thread, messageLimit }));

  // Pinned docs — reuse pre-fetched if available, otherwise fetch with token cap.
  const pinnedDocs =
    prefetchedPinnedDocs ??
    (await new DocumentManager({
      workspace,
      maxTokens: LLMConnector.promptWindowLimit(),
    }).pinnedDocs());
  pinnedDocs.forEach((doc) => {
    const { pageContent, ...metadata } = doc;
    pinnedDocIdentifiers.push(sourceIdentifier(doc));
    contextTexts.push(doc.pageContent);
    sources.push({
      text:
        pageContent.slice(0, 1_000) + "...continued on in source document...",
      ...metadata,
    });
  });

  // Parsed files — reuse pre-fetched if available, otherwise fetch fresh.
  const parsedFiles =
    prefetchedParsedFiles ??
    (await WorkspaceParsedFiles.getContextFiles(
      workspace,
      thread || null,
      user || null
    ));
  parsedFiles.forEach((doc) => {
    const { pageContent, ...metadata } = doc;
    contextTexts.push(doc.pageContent);
    sources.push({
      text:
        pageContent.slice(0, 1_000) + "...continued on in source document...",
      ...metadata,
    });
  });

  const vectorSearchResults =
    embeddingsCount !== 0
      ? await runExpandedBodySearch({
          originalQuestion: relatedImageSearchQuery,
          expandedBodyQuery: bodySearchQuery,
          topN: workspace?.topN,
          search: ({
            input,
            includeRelatedImages,
            relatedImageQueryText,
          }) =>
            VectorDb.performSimilaritySearch({
              namespace: workspace.slug,
              input,
              relatedImageQueryText,
              includeRelatedImages,
              LLMConnector,
              similarityThreshold: workspace?.similarityThreshold,
              topN: workspace?.topN,
              filterIdentifiers: pinnedDocIdentifiers,
              rerank: workspace?.vectorSearchMode === "rerank",
            }),
        })
      : {
          contextTexts: [],
          sources: [],
          message: null,
        };

  // Failed similarity search if it was run at all and failed.
  if (!!vectorSearchResults.message) {
    writeResponseChunk(response, {
      id: uuid,
      type: "abort",
      textResponse: null,
      sources: [],
      close: true,
      error: vectorSearchResults.message,
    });
    return;
  }

  const { fillSourceWindow } = require("../helpers/chat");
  const filledSources = fillSourceWindow({
    nDocs: workspace?.topN || 4,
    searchResults: vectorSearchResults.sources,
    history: rawHistory,
    filterIdentifiers: pinnedDocIdentifiers,
  });

  // Why does contextTexts get all the info, but sources only get current search?
  // This is to give the ability of the LLM to "comprehend" a contextual response without
  // populating the Citations under a response with documents the user "thinks" are irrelevant
  // due to how we manage backfilling of the context to keep chats with the LLM more correct in responses.
  // If a past citation was used to answer the question - that is visible in the history so it logically makes sense
  // and does not appear to the user that a new response used information that is otherwise irrelevant for a given prompt.
  // TLDR; reduces GitHub issues for "LLM citing document that has no answer in it" while keep answers highly accurate.
  contextTexts = [...contextTexts, ...filledSources.contextTexts];
  sources = [...sources, ...vectorSearchResults.sources];

  // Query mode and SCHAT employee chat both fail closed when retrieval found no
  // evidence, so Gemini cannot answer from general knowledge.
  if ((chatMode === "query" || safetyEnabled) && contextTexts.length === 0) {
    const textResponse =
      workspace?.queryRefusalResponse ??
      (process.env.SCHAT_SAFETY_ENABLED === "true"
        ? "등록된 병원 지침에서 관련 근거를 확인할 수 없습니다."
        : "There is no relevant information in this workspace to answer your query.");
    writeResponseChunk(response, {
      id: uuid,
      type: "textResponse",
      textResponse,
      sources: [],
      close: true,
      error: null,
    });

    await WorkspaceChats.new({
      workspaceId: workspace.id,
      prompt: message,
      response: {
        text: textResponse,
        sources: [],
        type: chatMode,
        attachments: attachmentsForChatRecord(attachments, safetyEnabled),
      },
      threadId: thread?.id || null,
      include: false,
      user,
    });
    return;
  }

  if (safetyEnabled) {
    // SCHAT employee chat stays closed-book and structured. The optional
    // Python evaluator is selected separately by SCHAT_SAFETY_GATE_ENABLED.
    const { runSchatCompletion } = require("../schatSafety/chat");
    const safeResult = await runSchatCompletion({
      safetyGateEnabled,
      question: updatedMessage,
      sources,
      relatedImageSources: vectorSearchResults.relatedImageSources || [],
      attachments,
      LLMConnector,
      user,
      temperature: workspace?.openAiTemp ?? LLMConnector.defaultTemp,
    });
    completeText = safeResult.text;
    sources = safeResult.sources;
    safety = safeResult.safety;
    presentation = safeResult.presentation;
    relatedImages = safeResult.relatedImages || [];
    metrics = addChatCostToMetrics(safeResult.metrics, {
      routingMetadata,
      workspace,
      connector: LLMConnector,
    });
    writeResponseChunk(response, {
      uuid,
      sources,
      type: "textResponseChunk",
      textResponse: completeText,
      close: true,
      error: false,
      metrics,
      safety,
      ...(presentation ? { presentation } : {}),
      ...(relatedImages.length ? { relatedImages } : {}),
    });
  } else {
    // Compress & Assemble message to ensure prompt passes token limit with room for response
    // and build system messages based on inputs and history.
    // Reuse the system prompt from routing pre-fetch when available.
    const systemPrompt =
      prefetchedContext?.systemPrompt ??
      (await chatPrompt(workspace, user, {
        prompt: updatedMessage,
        rawHistory,
      }));
    const messages = await LLMConnector.compressMessages(
      {
        systemPrompt,
        userPrompt: updatedMessage,
        contextTexts,
        chatHistory,
        attachments,
      },
      rawHistory
    );

    // If streaming is not explicitly enabled for connector
    // we do regular waiting of a response and send a single chunk.
    if (LLMConnector.streamingEnabled() !== true) {
      console.log(
        `\x1b[31m[STREAMING DISABLED]\x1b[0m Streaming is not available for ${LLMConnector.constructor.name}. Will use regular chat method.`
      );
      const { textResponse, metrics: performanceMetrics } =
        await LLMConnector.getChatCompletion(messages, {
          temperature: workspace?.openAiTemp ?? LLMConnector.defaultTemp,
          user: user,
        });

      completeText = textResponse;
      metrics = addChatCostToMetrics(performanceMetrics, {
        routingMetadata,
        workspace,
        connector: LLMConnector,
      });
      writeResponseChunk(response, {
        uuid,
        sources,
        type: "textResponseChunk",
        textResponse: completeText,
        close: true,
        error: false,
        metrics,
      });
    } else {
      const stream = await LLMConnector.streamGetChatCompletion(messages, {
        temperature: workspace?.openAiTemp ?? LLMConnector.defaultTemp,
        user: user,
      });
      completeText = await LLMConnector.handleStream(response, stream, {
        uuid,
        sources,
      });
      metrics = addChatCostToMetrics(stream.metrics, {
        routingMetadata,
        workspace,
        connector: LLMConnector,
      });
    }
  }

  if (completeText?.length > 0) {
    // SCHAT 직원 채팅에서는 원본 이미지가 채팅 기록이나 일반 로그에
    // 남지 않도록 서버 메모리에서 처리한 뒤 저장 payload에서 제외한다.
    const persistedAttachments = attachmentsForChatRecord(
      attachments,
      safetyEnabled
    );
    const { chat } = await WorkspaceChats.new({
      workspaceId: workspace.id,
      prompt: message,
      response: {
        text: completeText,
        sources,
        type: chatMode,
        attachments: persistedAttachments,
        metrics,
        ...(presentation ? { presentation } : {}),
        ...(relatedImages.length ? { relatedImages } : {}),
        ...(safety ? { safety } : {}),
      },
      threadId: thread?.id || null,
      user,
    });

    writeResponseChunk(response, {
      uuid,
      type: "finalizeResponseStream",
      close: true,
      error: false,
      chatId: chat.id,
      metrics,
    });
    return;
  }

  writeResponseChunk(response, {
    uuid,
    type: "finalizeResponseStream",
    close: true,
    error: false,
    metrics,
  });
  return;
}

async function resolveLLMConnector({
  workspace,
  message,
  user,
  thread,
  attachments,
}) {
  try {
    const result = await resolveProviderConnector({
      workspace,
      prompt: message,
      user,
      thread,
      attachments,
    });
    return { ...result, error: null };
  } catch (routerError) {
    return {
      connector: null,
      routingMetadata: null,
      prefetchedContext: null,
      error: `Model router error: ${routerError.message}`,
    };
  }
}

module.exports = {
  VALID_CHAT_MODE,
  streamChatWithWorkspace,
};
