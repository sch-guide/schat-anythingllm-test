// QuizGenerationService - the ONLY place the quiz feature calls Gemini.
// Used by the admin "AI로 문제 만들기" and "다시 생성" endpoints only.
//
// 1. Evidence: body-text chunks of the chosen document are read from the
//    workspace's Chroma collection and ranked for the topic with the existing
//    SCHAT BM25 (local, no external call). AI-written image descriptions are
//    excluded. Only the top pages (bounded size) are sent - never a whole PDF.
// 2. Gemini gets the evidence with strict rules and a strict JSON schema.
// 3. Every item is checked against the evidence (cited page must be one that
//    was sent, 4 distinct choices / O-X, numbers found on the page) and saved
//    as 작성중 (draft). Nothing reaches staff until an admin publishes it.
// Stored: questions and a small log row. Not stored: prompt, source text sent,
// provider response or the API key.
const prisma = require("../prisma");
const core = require("./core");
const bank = require("./bank");

const MAX_EVIDENCE_CHARS = 12000;
const MAX_EVIDENCE_PAGES = 10;
const MAX_GENERATE = 20;

// Visible to the admin statistics endpoint and to tests: how many times this
// service asked Gemini for questions since the server started.
const counters = { requests: 0, geminiCalls: 0 };

const GENERATION_SCHEMA = {
  type: "object",
  properties: {
    insufficient: { type: "boolean" },
    questions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          question: { type: "string" },
          choices: { type: "array", items: { type: "string" } },
          correctIndex: { type: "integer" },
          oxAnswer: { type: "string", enum: ["O", "X", ""] },
          explanation: { type: "string" },
          sourcePage: { type: "integer" },
          evidenceQuote: { type: "string" },
        },
        required: [
          "question",
          "choices",
          "correctIndex",
          "oxAnswer",
          "explanation",
          "sourcePage",
          "evidenceQuote",
        ],
        additionalProperties: false,
      },
    },
  },
  required: ["insufficient", "questions"],
  additionalProperties: false,
};

const DIFFICULTY_GUIDE = {
  beginner: "기본 용어·절차 순서처럼 근거 문장을 그대로 확인하는 문제",
  intermediate: "근거의 조건·기준·수치를 정확히 구분해야 하는 문제",
  advanced:
    "근거 안의 여러 조건을 함께 따져야 하는 문제(단, 근거에 없는 추론은 금지)",
};

function systemPrompt({ type, difficulty }) {
  return [
    "당신은 병원 간호 실무지침서로 교육용 퀴즈를 만드는 도우미입니다.",
    "반드시 지킬 규칙:",
    "1. 아래 [근거]에 적힌 내용만으로 문제·정답·해설을 만듭니다. 일반 의학지식이나 다른 병원 기준을 더하지 않습니다.",
    "2. 근거에 없는 정답을 만들지 않습니다. 정답은 하나만 명확해야 하며 애매한 선택지를 만들지 않습니다.",
    "3. 숫자·시간·용량·단위는 근거에 적힌 그대로 씁니다. 바꾸거나 새로 만들지 않습니다.",
    "4. sourcePage는 그 문제의 근거가 있는 쪽 번호([p.N]의 N)로, 제공된 쪽 중 하나여야 합니다.",
    "5. explanation은 근거 내용과 일치하게 한국어로 1~3문장으로 씁니다.",
    "6. evidenceQuote에는 정답의 근거가 되는 문장을 근거에서 그대로(수정 없이) 옮깁니다.",
    "7. 근거가 부족해 규칙을 지킬 수 없으면 문제를 만들지 말고 insufficient를 true로 합니다. 요청 수보다 적게 만들어도 됩니다.",
    type === "ox"
      ? '8. 문제 유형은 OX입니다. question은 참/거짓을 판단할 한 문장, choices는 빈 배열, correctIndex는 -1, oxAnswer는 "O" 또는 "X"입니다.'
      : "8. 문제 유형은 4지선다 객관식입니다. choices는 서로 다른 4개, correctIndex는 정답의 위치(0~3), oxAnswer는 빈 문자열입니다.",
    `9. 난이도: ${DIFFICULTY_GUIDE[difficulty]}. 난이도를 맞추려고 근거 범위를 벗어나지 않습니다.`,
    "10. 같은 내용을 묻는 문제를 반복하지 않습니다.",
  ].join("\n");
}

/**
 * Relevant body-text pages of one document for a topic, via the live Chroma
 * collection and the existing BM25 ranking. No embedding/LLM call.
 */
async function collectEvidence(
  { documentId, workspaceSlug, topic },
  { vectorDb = null } = {}
) {
  const { getVectorDbClass } = require("../helpers");
  const { rankByBm25 } = require("../vectorDbProviders/chroma/schatBm25");
  const VectorDb = vectorDb || getVectorDbClass();
  const { client } = await VectorDb.connect();
  const collection = await client.getCollection({
    name: VectorDb.normalize
      ? VectorDb.normalize(workspaceSlug)
      : workspaceSlug,
  });
  const stored = await collection.get({
    where: { document_id: documentId },
    include: ["documents", "metadatas"],
  });
  const corpus = stored.ids
    .map((id, i) => ({
      id,
      text: stored.documents[i],
      metadata: stored.metadatas[i] || {},
      corpusPosition: i,
    }))
    .filter(
      (d) =>
        d.text &&
        d.metadata.content_type !== "image_description" &&
        Number.isInteger(Number(d.metadata.page))
    );
  const ranked = rankByBm25(topic, corpus);
  const pages = new Map();
  let chars = 0;
  for (const hit of ranked) {
    const page = Number(hit.metadata?.page);
    if (!pages.has(page)) {
      if (pages.size >= MAX_EVIDENCE_PAGES) continue;
      pages.set(page, {
        page,
        section: hit.metadata?.section || "",
        texts: [],
      });
    }
    const entry = pages.get(page);
    const text = String(hit.text || "").trim();
    if (!text || entry.texts.includes(text)) continue;
    if (chars + text.length > MAX_EVIDENCE_CHARS) continue;
    entry.texts.push(text);
    chars += text.length;
  }
  return [...pages.values()]
    .filter((p) => p.texts.length)
    .sort((a, b) => a.page - b.page)
    .map((p) => ({
      page: p.page,
      section: p.section,
      text: p.texts.join("\n"),
    }));
}

function evidencePrompt(evidence, { topic, count, type, difficulty }) {
  const blocks = evidence
    .map((e) => `[p.${e.page}]${e.section ? ` (${e.section})` : ""}\n${e.text}`)
    .join("\n\n");
  return [
    `주제: ${topic}`,
    `문제 유형: ${core.QUESTION_TYPE[type]}`,
    `난이도: ${core.DIFFICULTY[difficulty]}`,
    `요청 문항 수: ${count}`,
    "",
    "[근거]",
    blocks,
  ].join("\n");
}

function defaultLlm() {
  const { GeminiLLM } = require("../AiProviders/gemini");
  return new GeminiLLM(null, process.env.GEMINI_LLM_MODEL_PREF || null);
}

async function askGemini(llm, messages) {
  counters.geminiCalls += 1;
  const result = await llm.getChatCompletion(messages, {
    temperature: 0.2,
    responseSchema: GENERATION_SCHEMA,
  });
  const text = result?.textResponse;
  if (!text) throw Object.assign(new Error("empty"), { code: "empty" });
  try {
    return JSON.parse(text);
  } catch {
    throw Object.assign(new Error("invalid_json"), { code: "invalid_json" });
  }
}

function errorCode(error) {
  const message = String(error?.message || "");
  if (error?.code) return String(error.code).slice(0, 40);
  if (/429|quota|rate/i.test(message)) return "rate_limited";
  if (/401|403|api key/i.test(message)) return "unauthorized";
  if (/timeout|timed out|abort/i.test(message)) return "timeout";
  return "failed";
}

function validateRequest(input = {}) {
  const topic = core.clean(input.topic, 60);
  const count = Number.parseInt(input.count, 10);
  if (!topic) throw bank.userError("주제를 입력해 주세요.");
  if (!Number.isInteger(count) || count < 1 || count > MAX_GENERATE)
    throw bank.userError(`문항 수는 1~${MAX_GENERATE} 사이로 입력해 주세요.`);
  if (!core.DIFFICULTY[input.difficulty])
    throw bank.userError("난이도를 선택해 주세요.");
  if (!core.QUESTION_TYPE[input.questionType])
    throw bank.userError("문제 유형을 선택해 주세요.");
  return {
    topic,
    count,
    difficulty: input.difficulty,
    type: input.questionType,
  };
}

async function logGeneration(data) {
  return prisma.schat_quiz_generation_logs.create({ data }).catch(() => null);
}

/**
 * 관리자 "AI로 문제 만들기". Returns the new draft set and questions.
 * Failure never touches existing questions: staff keep using the bank.
 */
async function generate(
  adminId,
  input = {},
  // live/log are injectable so tests never touch the real database.
  {
    llm = null,
    vectorDb = null,
    live: liveMap = null,
    log = logGeneration,
  } = {}
) {
  counters.requests += 1;
  const request = validateRequest(input);
  const live = liveMap || (await bank.liveDocuments({ fresh: true }));
  const doc = bank.documentByKey(live, input.docKey);
  if (!doc || !doc.workspaceSlug)
    throw bank.userError("대상 문서를 선택해 주세요.");

  const evidence = await collectEvidence(
    {
      documentId: doc.documentId,
      workspaceSlug: doc.workspaceSlug,
      topic: request.topic,
    },
    { vectorDb }
  );
  if (!evidence.length) {
    await log({
      admin_id: adminId,
      document_id: doc.documentId,
      topic: request.topic,
      requested: request.count,
      status: "no_evidence",
    });
    throw bank.userError(
      "이 문서에서 해당 주제의 근거를 찾지 못했습니다. 주제를 바꿔 다시 시도해 주세요."
    );
  }

  let output;
  try {
    output = await askGemini(llm || defaultLlm(), [
      { role: "system", content: systemPrompt(request) },
      { role: "user", content: evidencePrompt(evidence, request) },
    ]);
  } catch (error) {
    const code = errorCode(error);
    console.error("[schat-quiz] generation failed:", code);
    await log({
      admin_id: adminId,
      document_id: doc.documentId,
      topic: request.topic,
      requested: request.count,
      status: "failed",
      error_code: code,
    });
    throw bank.userError(
      "문제를 생성하지 못했습니다. 잠시 후 다시 시도해주세요."
    );
  }

  const evidenceByPage = new Map(evidence.map((e) => [e.page, e.text]));
  const sectionByPage = new Map(evidence.map((e) => [e.page, e.section]));
  const seen = new Set();
  const rows = [];
  let rejected = 0;
  for (const item of (output?.questions || []).slice(0, request.count)) {
    const row = core.checkGeneratedItem(item, {
      type: request.type,
      evidenceByPage,
    });
    if (!row || seen.has(row.question)) {
      rejected += 1;
      continue;
    }
    seen.add(row.question);
    rows.push({
      ...row,
      source_section: sectionByPage.get(row.source_page) || null,
    });
  }

  const logRow = await log({
    admin_id: adminId,
    document_id: doc.documentId,
    topic: request.topic,
    requested: request.count,
    created_count: rows.length,
    status: rows.length ? "ok" : "no_evidence",
  });
  if (!rows.length)
    throw bank.userError(
      "근거가 충분하지 않아 문제를 만들지 않았습니다. 주제를 더 구체적으로 입력해 주세요."
    );

  const common = {
    document_id: doc.documentId,
    source_document_name: doc.title,
    document_version: doc.version,
  };
  const set = await prisma.schat_quiz_sets.create({
    data: {
      ...common,
      title: `${request.topic} ${core.DIFFICULTY[request.difficulty]} 퀴즈`,
      topic: request.topic,
      difficulty: request.difficulty,
      question_type: request.type,
      status: "draft",
      created_by: adminId,
    },
  });
  await prisma.$transaction(
    rows.map((row) =>
      prisma.schat_quiz_questions.create({
        data: {
          ...common,
          ...row,
          quiz_set_id: set.id,
          workspace_slug: doc.workspaceSlug,
          topic: request.topic,
          difficulty: request.difficulty,
          status: "draft",
          created_by: adminId,
          generation_id: logRow?.id ?? null,
        },
      })
    )
  );
  return {
    quizSetId: set.id,
    created: rows.length,
    requested: request.count,
    rejected,
    insufficient: !!output?.insufficient,
    evidencePages: evidence.map((e) => e.page),
  };
}

/**
 * 다시 생성: replaces one draft/inactive question with a new AI draft from the
 * same document, topic, difficulty and type. The only other Gemini call site.
 */
async function regenerate(
  adminId,
  questionId,
  { llm = null, vectorDb = null } = {}
) {
  counters.requests += 1;
  const q = await prisma.schat_quiz_questions.findUnique({
    where: { id: Number(questionId) },
  });
  if (!q) throw bank.userError("문제를 찾을 수 없습니다.");
  if (q.status === "approved")
    throw bank.userError("공개 중인 문제는 사용중지한 뒤 다시 생성해 주세요.");
  const live = await bank.liveDocuments({ fresh: true });
  const doc = live.get(q.document_id);
  if (!doc)
    throw bank.userError("이전 문서 기반 문제는 다시 생성할 수 없습니다.");
  const request = {
    topic: q.topic,
    count: 1,
    difficulty: q.difficulty,
    type: q.question_type,
  };
  const evidence = await collectEvidence(
    {
      documentId: q.document_id,
      workspaceSlug: doc.workspaceSlug,
      topic: q.topic,
    },
    { vectorDb }
  );
  if (!evidence.length)
    throw bank.userError("이 문서에서 해당 주제의 근거를 찾지 못했습니다.");
  let output;
  try {
    output = await askGemini(llm || defaultLlm(), [
      { role: "system", content: systemPrompt(request) },
      {
        role: "user",
        content: `${evidencePrompt(evidence, request)}\n\n[피해야 할 기존 문제]\n${q.question}`,
      },
    ]);
  } catch (error) {
    const code = errorCode(error);
    console.error("[schat-quiz] regeneration failed:", code);
    await logGeneration({
      admin_id: adminId,
      document_id: q.document_id,
      topic: q.topic,
      requested: 1,
      status: "failed",
      error_code: code,
    });
    throw bank.userError(
      "문제를 생성하지 못했습니다. 잠시 후 다시 시도해주세요."
    );
  }
  const evidenceByPage = new Map(evidence.map((e) => [e.page, e.text]));
  const row = (output?.questions || [])
    .map((item) =>
      core.checkGeneratedItem(item, { type: q.question_type, evidenceByPage })
    )
    .find(Boolean);
  const log = await logGeneration({
    admin_id: adminId,
    document_id: q.document_id,
    topic: q.topic,
    requested: 1,
    created_count: row ? 1 : 0,
    status: row ? "ok" : "no_evidence",
  });
  if (!row)
    throw bank.userError("근거가 충분하지 않아 새 문제를 만들지 않았습니다.");
  const sectionByPage = new Map(evidence.map((e) => [e.page, e.section]));
  await prisma.schat_quiz_questions.update({
    where: { id: q.id },
    data: {
      ...row,
      source_section: sectionByPage.get(row.source_page) || null,
      status: "draft",
      updated_by: adminId,
      generation_id: log?.id ?? null,
      updatedAt: new Date(),
    },
  });
  return bank.adminQuestion(q.id);
}

module.exports = {
  GENERATION_SCHEMA,
  counters,
  systemPrompt,
  evidencePrompt,
  collectEvidence,
  generate,
  regenerate,
  MAX_GENERATE,
};
