const { createHash } = require('node:crypto');
const { normalizeQuestion } = require('../answerCache');

const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');

// SCHAT grounded completion does not inject chatPrompt's private memories or
// user variables. Only its history-free query/chat requests qualify; generic
// (non-SCHAT) chat and the model router remain out of scope.
async function prepareAnswerCache(input, injected) {
  const {workspace, message, updatedMessage, chatMode, user, thread, attachments=[]} = input;
  const env = injected?.env || process.env;
  const provider = workspace?.chatProvider || env.LLM_PROVIDER;
  if (env.SCHAT_SAFETY_ENABLED !== 'true' || env.SCHAT_SAFETY_GATE_ENABLED === 'true' ||
      // Native/default embeddings write from another process, outside this
      // cache generation boundary. Match EmbeddingWorkerManager's routing.
      !env.EMBEDDING_ENGINE || env.EMBEDDING_ENGINE === 'native' ||
      !['query', 'chat'].includes(chatMode) || workspace?.chatMode === 'automatic' ||
      !Number.isSafeInteger(workspace?.id) || workspace.id <= 0 ||
      !provider || provider === 'anythingllm-router' || attachments.length ||
      message !== updatedMessage || /(^|\s)[/@]/u.test(message) || !normalizeQuestion(message)) return null;
  try {
    const prisma = injected?.prisma || require('../prisma');
    const cache = injected?.cache || require('../answerCacheRuntime').cache;
    // Capture the generation BEFORE asynchronous reads: changes during any
    // preflight lookup must also reject the eventual completion's late put.
    const generation = cache.generation(workspace.id);
    const [history, files, documents] = await Promise.all([
      prisma.workspace_chats.findMany({where:{workspaceId:workspace.id,user_id:user?.id || null,
        thread_id:thread?.id || null,api_session_id:null,include:true},take:1,select:{id:true}}),
      // A single personal file in this workspace makes reuse ineligible. Query
      // raw rows so missing/corrupt file metadata cannot be mistaken for empty.
      prisma.workspace_parsed_files.findMany({where:{workspaceId:workspace.id},take:1,select:{id:true}}),
      prisma.workspace_documents.findMany({where:{workspaceId:workspace.id},orderBy:{id:'asc'}}),
    ]);
    // Watched documents may be refreshed by a separate worker process, beyond
    // this process's mutation boundary. Do not share answers from that corpus.
    if (history.length || files.length || !documents.length ||
        documents.some(document => document.watched) || generation !== cache.generation(workspace.id)) return null;
    const model = workspace.chatModel || (injected?.model || require('../helpers').getBaseLLMProviderModel)({provider});
    // Missing a model identity is ambiguous; prefer a miss to stale reuse.
    if (!model) return null;
    const context = {
      version:'schat-grounded-answer-v1',provider,model,mode:chatMode,
      workspaceMode:workspace.chatMode,
      prompt:workspace.openAiPrompt ?? null,
      temperature:workspace.openAiTemp ?? null,
      topN:workspace.topN ?? null,similarityThreshold:workspace.similarityThreshold ?? null,
      vectorSearchMode:workspace.vectorSearchMode ?? null,
      queryRefusalResponse:workspace.queryRefusalResponse ?? null,
      vectorDb:env.VECTOR_DB ?? null,embedder:env.EMBEDDING_ENGINE ?? null,
      corpus:hash(documents),
    };
    return {workspaceId:workspace.id,generation,context};
  } catch {
    // Cache availability must never turn a failed eligibility check into a hit.
    return null;
  }
}

module.exports = { prepareAnswerCache };
