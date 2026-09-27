const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  buildRagContext,
  buildPublicRagSource,
  ragSourceIdentity,
} = require("../../../../utils/agents/aibitat/utils/ragSources");
const AIbitat = require("../../../../utils/agents/aibitat");
const { WorkspaceChats } = require("../../../../models/workspaceChats");
const {
  chatHistory,
} = require("../../../../utils/agents/aibitat/plugins/chat-history");
const {
  attachRelatedImageSources,
} = require("../../../../utils/agents/aibitat/plugins/memory");

test("a PDF source exposes only an opaque stable pdfRef for original viewing", () => {
  const previousRoot = process.env.SCHAT_ORIGINAL_DOCUMENTS_DIR;
  process.env.SCHAT_ORIGINAL_DOCUMENTS_DIR = fs.mkdtempSync(
    path.join(os.tmpdir(), "schat-rag-pdf-ref-")
  );
  try {
    const source = buildPublicRagSource({
      id: "private-vector",
      document_id: "private-document-id",
      document_name: "hospital-guide.pdf",
      page: 273,
      text: "exact evidence",
    });

    assert.match(source.pdfRef, /^[A-Za-z0-9_-]{43}$/);
    assert.doesNotMatch(JSON.stringify(source), /private-document-id|private-vector/);
  } finally {
    if (previousRoot === undefined)
      delete process.env.SCHAT_ORIGINAL_DOCUMENTS_DIR;
    else process.env.SCHAT_ORIGINAL_DOCUMENTS_DIR = previousRoot;
  }
});

test("a non-PDF source does not receive a pdfRef", () => {
  const source = buildPublicRagSource({
    document_id: "web-document",
    document_name: "notes.txt",
    text: "plain text evidence",
  });

  assert.equal(Object.hasOwn(source, "pdfRef"), false);
});

function publicSourcesWithRelatedImages(question) {
  const mixedKey = "1".repeat(64);
  const competingKey = "2".repeat(64);
  const decorativeKey = "3".repeat(64);
  const sources = [
    {
      id: "body-source",
      document_id: "hospital-guide",
      document_name: "guide.pdf",
      page: 100,
      section: "pain assessment",
      text: "Hospital pain assessment guidance.",
      related_image_keys: JSON.stringify([
        mixedKey,
        competingKey,
        decorativeKey,
        "9".repeat(64),
      ]),
    },
  ];
  const relatedImageSources = [
    {
      id: "mixed-image",
      document_id: "hospital-guide",
      document_name: "guide.pdf",
      page: 100,
      section: "pain assessment",
      content_type: "image_description",
      image_key: mixedKey,
      text: "NRS, FPRS, and FLACC pain assessment screen",
    },
    {
      id: "competing-image",
      document_id: "hospital-guide",
      document_name: "guide.pdf",
      page: 100,
      section: "pain assessment",
      content_type: "image_description",
      image_key: competingKey,
      text:
        question.startsWith("NRS")
          ? "FPRS facial pain scale"
          : "NRS numeric pain scale",
    },
    {
      id: "decorative-image",
      document_id: "hospital-guide",
      document_name: "guide.pdf",
      page: 100,
      section: "pain assessment",
      content_type: "image_description",
      image_key: decorativeKey,
      text: `${question} hospital logo decorative image`,
    },
    {
      id: "mixed-image-duplicate",
      document_id: "hospital-guide",
      document_name: "guide.pdf",
      page: 100,
      section: "pain assessment",
      content_type: "image_description",
      image_key: mixedKey,
      text: "NRS, FPRS, and FLACC pain assessment screen",
    },
  ];
  const linkedSources = attachRelatedImageSources(
    sources,
    relatedImageSources,
    question
  );
  const aibitat = new AIbitat({ provider: "openai" });
  aibitat.addRagMemorySources(linkedSources, { question });
  return aibitat.getRagMemorySources();
}

for (const question of ["NRS", "NRS 통증척도는 어떻게 평가해?", "FPRS"]) {
  test(`rag-memory attaches only focused image-description candidates: ${question}`, () => {
    const sources = publicSourcesWithRelatedImages(question);
    const images = sources.flatMap((source) => source.relatedImages || []);

    assert.equal(sources.length, 1);
    assert.equal(sources[0].excerpt, "Hospital pain assessment guidance.");
    assert.deepEqual(
      images.map((image) => image.imageKey),
      ["1".repeat(64)]
    );
    assert.doesNotMatch(
      JSON.stringify(sources),
      /image_description|NRS, FPRS, and FLACC pain assessment screen/
    );
  });
}

test("rag-memory source uses its own text as the exact excerpt", () => {
  const source = buildPublicRagSource({
    id: "vector-secret",
    document_id: "document-secret",
    document_name: "C:\\private\\2026실무지침서.pdf",
    page: 100,
    section: "통증 평가",
    text: "NRS는 환자가 통증 정도를 숫자로 표현하는 평가 도구입니다.",
    exact_text: "다른 배열에서 잘못 연결된 원문",
    chunkSource: "file:///app/server/storage/private.pdf",
  });

  assert.equal(
    source.excerpt,
    "NRS는 환자가 통증 정도를 숫자로 표현하는 평가 도구입니다."
  );
  assert.equal(source.text, source.excerpt);
  assert.equal(source.documentName, "2026실무지침서.pdf");
  assert.doesNotMatch(
    JSON.stringify(source),
    /vector-secret|document-secret|private|chunkSource|exact_text/i
  );
});

test("stable internal identity deduplicates repeated rag-memory results", () => {
  const first = ragSourceIdentity({
    id: "same-vector",
    document_id: "same-document",
    text: "첫 검색 원문",
  });
  const second = ragSourceIdentity({
    id: "same-vector",
    document_id: "same-document",
    text: "두 번째 호출에서 다시 검색된 원문",
  });

  assert.equal(first, second);
});

test("Gemini context is built from the same retrieved source text", () => {
  const context = buildRagContext([
    { text: "first exact source" },
    { text: "second exact source" },
  ]);

  assert.match(context, /first exact source/);
  assert.match(context, /second exact source/);
  assert.doesNotMatch(context, /search the web/i);
});

test("empty retrieval produces the closed-book context instead of web-search advice", () => {
  const context = buildRagContext([]);

  assert.match(context, /등록된 병원 문서에서 근거를 찾지 못했/);
  assert.match(context, /일반 지식으로 보완하지/);
  assert.doesNotMatch(context, /search the web/i);
});

test("only a directly retrieved image_description exposes its single image", () => {
  const imageKey = "a".repeat(64);
  const source = buildPublicRagSource({
    id: "nrs-image-source",
    document_name: "통증지침.pdf",
    page: 100,
    section: "통증 평가",
    content_type: "image_description",
    image_key: imageKey,
    related_image_keys: JSON.stringify(["b".repeat(64)]),
    text: "NRS를 선택하고 0점부터 10점까지 통증 점수를 입력하는 화면",
  });

  assert.deepEqual(source.relatedImages, [
    {
      imageKey,
      documentName: "통증지침.pdf",
      page: 100,
      section: "통증 평가",
      matchType: "image_description",
    },
  ]);
  assert.doesNotMatch(JSON.stringify(source), new RegExp("b".repeat(64)));
});

test("a directly linked source image is exposed without page-wide image expansion", () => {
  const imageKey = "d".repeat(64);
  const source = buildPublicRagSource(
    {
      document_name: "guide.pdf",
      page: 100,
      section: "pain assessment",
      image_key: imageKey,
      related_image_keys: JSON.stringify(["e".repeat(64)]),
      text: "NRS pain assessment source",
    },
    { question: "NRS" }
  );

  assert.equal(source.relatedImages.length, 1);
  assert.equal(source.relatedImages[0].imageKey, imageKey);
  assert.equal(source.relatedImages[0].matchType, "source_unit");
  assert.doesNotMatch(JSON.stringify(source), new RegExp("e".repeat(64)));
});

test("NRS accepts a mixed pain-scale image but rejects an FPRS-only image", () => {
  const fprsOnly = buildPublicRagSource(
    {
      document_name: "guide.pdf",
      content_type: "image_description",
      image_key: "f".repeat(64),
      text: "FPRS 얼굴표정 통증척도",
    },
    { question: "NRS" }
  );
  const mixedScale = buildPublicRagSource(
    {
      document_name: "guide.pdf",
      content_type: "image_description",
      image_key: "a".repeat(64),
      text: "NRS, FPRS, FLACC, 수면중 등 통증 평가 도구를 선택할 수 있는 화면",
    },
    { question: "NRS" }
  );

  assert.deepEqual(fprsOnly.relatedImages, []);
  assert.equal(mixedScale.relatedImages.length, 1);
  assert.equal(mixedScale.relatedImages[0].imageKey, "a".repeat(64));
});

test("FPRS accepts a mixed pain-scale image but rejects an NRS-only image", () => {
  const nrsOnly = buildPublicRagSource(
    {
      document_name: "guide.pdf",
      content_type: "image_description",
      image_key: "b".repeat(64),
      text: "NRS 숫자 통증척도",
    },
    { question: "FPRS" }
  );
  const mixedScale = buildPublicRagSource(
    {
      document_name: "guide.pdf",
      content_type: "image_description",
      image_key: "c".repeat(64),
      text: "NRS, FPRS, FLACC 통증평가 화면",
    },
    { question: "FPRS" }
  );

  assert.deepEqual(nrsOnly.relatedImages, []);
  assert.equal(mixedScale.relatedImages.length, 1);
  assert.equal(mixedScale.relatedImages[0].imageKey, "c".repeat(64));
});

test("page-wide, decorative, and non-image sources do not expose images", () => {
  const imageKey = "c".repeat(64);
  const pageWideOnly = buildPublicRagSource({
    document_name: "지침.pdf",
    text: "NRS 본문 근거",
    related_image_keys: JSON.stringify([imageKey]),
  });
  const decorative = buildPublicRagSource({
    document_name: "지침.pdf",
    content_type: "image_description",
    image_key: imageKey,
    text: "병원 간호부 로고 장식 이미지",
  });

  assert.deepEqual(pageWideOnly.relatedImages, []);
  assert.deepEqual(decorative.relatedImages, []);
});

test("AIbitat accumulates only rag-memory sources and deduplicates repeated calls", () => {
  const sent = [];
  const aibitat = new AIbitat({ provider: "openai" });
  aibitat.socket = { send: (...args) => sent.push(args) };
  const source = {
    id: "same-vector",
    document_id: "same-document",
    document_name: "지침.pdf",
    page: 10,
    section: "통증",
    text: "NRS 통증 평가 근거",
  };

  aibitat.addCitation({ title: "검색하지 않은 웹 문서", text: "제외" });
  aibitat.addRagMemorySources([source]);
  aibitat.addRagMemorySources([{ ...source, text: "중복 호출" }]);
  aibitat.flushCitations("answer-uuid");

  assert.equal(aibitat.getRagMemorySources().length, 1);
  assert.equal(sent.length, 1);
  assert.equal(sent[0][1].type, "citations");
  assert.equal(sent[0][1].citations.length, 1);
  assert.equal(sent[0][1].citations[0].title, "지침.pdf · p.10 · 통증");
  assert.doesNotMatch(JSON.stringify(sent), /same-vector|same-document|웹 문서/);
});

test("clearing citations also clears the rag-memory accumulator", () => {
  const aibitat = new AIbitat({ provider: "openai" });
  aibitat.addRagMemorySources([
    { id: "source-1", document_name: "지침.pdf", text: "근거" },
  ]);

  aibitat.clearCitations();

  assert.deepEqual(aibitat.getRagMemorySources(), []);
});

test("chat history stores the sanitized rag-memory sources with the answer", async () => {
  const originalUpsert = WorkspaceChats.upsert;
  let stored = null;
  WorkspaceChats.upsert = async (_chatId, payload) => {
    stored = payload;
    return { chat: { id: 7 } };
  };
  const publicSource = buildPublicRagSource({
    id: "private-vector",
    document_name: "지침.pdf",
    text: "실제 검색 원문",
  });
  const fake = {
    handlerProps: {
      invocation: { workspace_id: 1, user_id: 2, thread_id: null },
    },
    providerInstance: { getCumulativeUsage: () => ({}) },
    trackedChatId: 7,
    getRagMemorySources: () => [publicSource],
    _pendingOutputs: [],
    _pendingClarifyingQuestionSurveys: [],
    _threadRenamed: true,
    clearCitations() {},
    clearClarifyingQuestionSurveys() {},
    clearTrackedChatId() {},
  };

  try {
    await chatHistory.plugin()._store(fake, {
      prompt: "NRS",
      response: "Automatic 자유형 답변",
    });
  } finally {
    WorkspaceChats.upsert = originalUpsert;
  }

  assert.equal(stored.response.text, "Automatic 자유형 답변");
  assert.deepEqual(stored.response.sources, [publicSource]);
  assert.doesNotMatch(JSON.stringify(stored.response.sources), /private-vector/);
});

function automaticReplyHarness(question) {
  const forcedSearches = [];
  const providerMessages = [];
  const aibitat = new AIbitat({
    provider: "openai",
    handlerProps: { log() {} },
  });
  aibitat.agent("agent", {
    role: "기존 Automatic system prompt",
    functions: ["rag-memory"],
  });
  aibitat.function({
    name: "rag-memory",
    description: "Search local workspace documents.",
    parameters: { type: "object", properties: {} },
    handler: async ({ action, content }) => {
      forcedSearches.push({ action, content });
      aibitat.addRagMemorySources([
        {
          id: `source-${forcedSearches.length}`,
          document_id: "hospital-guide",
          document_name: "병원지침.pdf",
          text: "실제 검색 원문",
        },
      ]);
      return "Additional context from the hospital guide.";
    },
  });
  aibitat.getProviderForConfig = () => ({
    supportsAgentStreaming: true,
    attachHandlerProps() {},
    resetCumulativeUsage() {},
    getCumulativeUsage: () => ({}),
    isModelLoaded: async () => true,
    stream: async (messages) => {
      providerMessages.push(messages);
      return {
        uuid: "automatic-answer",
        textResponse: "Automatic 자유형 답변",
      };
    },
  });
  aibitat.newMessage({
    from: "user",
    to: "agent",
    content: question,
  });

  return { aibitat, forcedSearches, providerMessages };
}

for (const question of [
  "NRS",
  "NRS 통증척도는 어떻게 평가해?",
  "FPRS",
  "수혈 절차 알려줘",
]) {
  test(`Automatic hospital question forces one rag-memory search: ${question}`, async () => {
    const { aibitat, forcedSearches, providerMessages } =
      automaticReplyHarness(question);

    const answer = await aibitat.reply({ from: "agent", to: "user" });

    assert.equal(answer, "Automatic 자유형 답변");
    assert.deepEqual(forcedSearches, [{ action: "search", content: question }]);
    assert.equal(aibitat.getRagMemorySources().length, 1);
    assert.equal(
      providerMessages[0].filter(
        (message) => message.role === "function" && message.name === "rag-memory"
      ).length,
      0
    );
    const userMessage = providerMessages[0].findLast(
      (message) => message.role === "user"
    );
    assert.match(userMessage.content, /hospital_document_context/);
    assert.match(userMessage.content, /Additional context from the hospital guide/);
  });
}

test("Automatic general weather chat does not force rag-memory", async () => {
  const { aibitat, forcedSearches, providerMessages } =
    automaticReplyHarness("오늘 날씨 어때?");

  const answer = await aibitat.reply({ from: "agent", to: "user" });

  assert.equal(answer, "Automatic 자유형 답변");
  assert.deepEqual(forcedSearches, []);
  assert.equal(aibitat.getRagMemorySources().length, 0);
  assert.equal(
    providerMessages[0].filter((message) => message.role === "function").length,
    0
  );
});
