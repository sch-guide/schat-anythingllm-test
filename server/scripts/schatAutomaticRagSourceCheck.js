const { Workspace } = require("../models/workspace");
const {
  WorkspaceAgentInvocation,
} = require("../models/workspaceAgentInvocation");
const { AgentHandler } = require("../utils/agents");

const QUESTIONS = [
  "NRS",
  "NRS 통증척도는 어떻게 평가해?",
  "FPRS",
  "수혈 절차 알려줘",
  "오늘 날씨 어때?",
];

function messageContent(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function runQuestion(workspace, question) {
  const { invocation, message } = await WorkspaceAgentInvocation.new({
    prompt: question,
    workspace,
  });
  if (!invocation) throw new Error(message || "automatic_invocation_failed");

  const events = [];
  const socket = {
    OPEN: 1,
    readyState: 1,
    send(raw) {
      const event = messageContent(raw);
      if (event) events.push(event);
    },
  };

  try {
    const handler = await new AgentHandler({ uuid: invocation.uuid }).init();
    if (!handler.invocation) throw new Error("automatic_handler_init_failed");
    await handler.createAIbitat({ socket });
    await handler.startAgentCluster();
    await new Promise((resolve) => setTimeout(resolve, 500));
  } finally {
    await WorkspaceAgentInvocation.close(invocation.uuid);
  }

  const streamEvents = events
    .filter((event) => event.type === "reportStreamEvent")
    .map((event) => event.content || {});
  const responseEvents = streamEvents.filter((event) =>
    ["fullTextResponse", "textResponseChunk"].includes(event.type)
  );
  const answer = responseEvents
    .map((event) => event.content || "")
    .join("");
  const citationEvent = streamEvents.find((event) => event.type === "citations");
  const sources = Array.isArray(citationEvent?.citations)
    ? citationEvent.citations
    : [];
  const images = sources.flatMap((source) => source.relatedImages || []);
  const serialized = JSON.stringify(sources);

  return {
    question,
    answerLength: answer.length,
    sourceCount: sources.length,
    excerptsPresent: sources.every(
      (source) => typeof source.excerpt === "string" && source.excerpt.length > 0
    ),
    directImageCount: images.length,
    duplicateSourceCount:
      sources.length -
      new Set(
        sources.map((source) =>
          [
            source.documentName,
            source.page,
            source.section,
            source.excerpt,
          ].join("\u001f")
        )
      ).size,
    duplicateImageCount:
      images.length - new Set(images.map((image) => image.imageKey)).size,
    nrsHasFprsImage:
      /^NRS\b/i.test(question) &&
      sources.some(
        (source) =>
          source.relatedImages?.length > 0 && /FPRS/i.test(source.excerpt || "")
      ),
    decorativeImageCount: sources.filter(
      (source) =>
        source.relatedImages?.length > 0 &&
        /(?:로고|장식|logo|decorative|watermark)/i.test(source.excerpt || "")
    ).length,
    internalFieldLeak:
      /(?:vectorId|chunk_id|document_id|source_unit|file:\/\/|\/app\/|\\storage\\)/i.test(
        serialized
      ),
  };
}

async function main() {
  if (process.env.SCHAT_ALLOW_LIVE_AUTOMATIC_TEST !== "true")
    throw new Error("Set SCHAT_ALLOW_LIVE_AUTOMATIC_TEST=true to run this check.");
  const slug = process.env.SCHAT_LIVE_TEST_WORKSPACE_SLUG || "schat-2026-09-22";
  const workspace = await Workspace.get({ slug });
  if (!workspace) throw new Error("live_test_workspace_not_found");
  if (workspace.chatMode !== "automatic")
    throw new Error(`workspace_chat_mode_is_${workspace.chatMode || "unset"}`);

  console.log(JSON.stringify({ phase: "workspace", chatMode: workspace.chatMode }));
  for (const question of QUESTIONS) {
    const result = await runQuestion(workspace, question);
    console.log(JSON.stringify({ phase: "question", ...result }));
  }
}

main().catch((error) => {
  console.error(JSON.stringify({ phase: "failed", error: error.message }));
  process.exitCode = 1;
});
