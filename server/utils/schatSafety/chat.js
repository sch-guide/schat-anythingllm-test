const { v4: uuidv4 } = require("uuid");
const { createSafetyClient } = require("./client");
const {
  finalizeSafetyDecision,
  formatValidatedAnswer,
  normalizeDisplaySources,
  normalizePage,
  sanitizeDisplayText,
  sanitizeEmployeeAnswer,
  REFUSAL_TEXT,
} = require("./finalize");
const {
  buildGroundedMultimodalMessages,
  validateSafetyImageAttachments,
} = require("./imageAttachment");
const { collectRelatedImages } = require("./relatedImages");

function prepareRetrievedChunks(sources = []) {
  return sources
    .map((source, index) => ({
      chunk_id: source.id || source.chunk_id || "",
      document_id: source.documentId || source.document_id || "",
      document_name: sanitizeDisplayText(
        source.document_name || source.title || ""
      ),
      page: normalizePage(source.page),
      section: sanitizeDisplayText(source.section),
      document_version: sanitizeDisplayText(
        source.document_version || source.published || ""
      ),
      schat_procedure_workflow_continuation:
        source.schat_procedure_workflow_continuation === true,
      related_image_keys:
        typeof source.related_image_keys === "string"
          ? source.related_image_keys
          : "",
      image_key:
        typeof source.image_key === "string" ? source.image_key : "",
      rank: index + 1,
      text: source.text || "",
    }))
    .filter((source) => source.chunk_id && source.document_id && source.text);
}

function parseCandidate(textResponse) {
  if (typeof textResponse !== "string" || !textResponse.trim())
    throw Object.assign(new Error("candidate_empty"), { code: "candidate_empty" });
  let parsed;
  try {
    parsed = JSON.parse(textResponse);
  } catch (_error) {
    throw Object.assign(new Error("candidate_json"), { code: "candidate_json" });
  }
  if (!Array.isArray(parsed?.statements))
    throw Object.assign(new Error("candidate_schema"), { code: "candidate_schema" });
  if (
    Object.keys(parsed).some((key) => key !== "statements") ||
    parsed.statements.length === 0 ||
    parsed.statements.some(
      (statement) =>
        !statement ||
        typeof statement !== "object" ||
        Array.isArray(statement) ||
        Object.keys(statement).some(
          (key) => !["text", "supporting_source_unit_ids"].includes(key)
        ) ||
        typeof statement.text !== "string" ||
        !statement.text.trim() ||
        !Array.isArray(statement.supporting_source_unit_ids) ||
        statement.supporting_source_unit_ids.length === 0 ||
        statement.supporting_source_unit_ids.some(
          (sourceId) => typeof sourceId !== "string" || !sourceId.trim()
        )
    )
  )
    throw Object.assign(new Error("candidate_schema"), {
      code: "candidate_schema",
    });
  return parsed;
}

function answerStyle(question = "") {
  const normalized = String(question).normalize("NFKC");
  if (/(?:종류|유형)/.test(normalized)) return "list";
  if (/(?:절차|방법|순서)/.test(normalized)) return "numbered_steps";
  if (/(?:준비|준비사항)/.test(normalized)) return "checklist";
  if (/(?:비교|차이)/.test(normalized)) return "comparison";
  return "explanation";
}

function sourceIdList(value) {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((sourceId) => typeof sourceId === "string" && sourceId.trim())
  );
}

function procedurePresentationSchema(identifiers) {
  const sourceIds = {
    type: "array",
    minItems: 1,
    maxItems: 8,
    items: { type: "string", enum: identifiers },
  };
  return {
    type: "object",
    properties: {
      summary_text: { type: "string" },
      summary_source_ids: sourceIds,
      items: {
        type: "array",
        minItems: 1,
        maxItems: 24,
        items: {
          type: "object",
          properties: {
            section_title: { type: "string" },
            text: { type: "string" },
            source_ids: sourceIds,
          },
          required: ["section_title", "text", "source_ids"],
          additionalProperties: false,
        },
      },
    },
    required: ["summary_text", "summary_source_ids", "items"],
    additionalProperties: false,
  };
}

function parseProcedureCandidate(textResponse) {
  if (typeof textResponse !== "string" || !textResponse.trim())
    throw Object.assign(new Error("candidate_empty"), { code: "candidate_empty" });
  let parsed;
  try {
    parsed = JSON.parse(textResponse);
  } catch (_error) {
    throw Object.assign(new Error("candidate_json"), { code: "candidate_json" });
  }
  const validFlatCandidate =
    parsed &&
    typeof parsed === "object" &&
    !Array.isArray(parsed) &&
    Object.keys(parsed).every((key) =>
      ["summary_text", "summary_source_ids", "items"].includes(key)
    ) &&
    typeof parsed.summary_text === "string" &&
    parsed.summary_text.trim() &&
    sourceIdList(parsed.summary_source_ids) &&
    Array.isArray(parsed.items) &&
    parsed.items.length > 0 &&
    parsed.items.every(
      (item) =>
        item &&
        typeof item === "object" &&
        !Array.isArray(item) &&
        Object.keys(item).every((key) =>
          ["section_title", "text", "source_ids"].includes(key)
        ) &&
        typeof item.section_title === "string" &&
        item.section_title.trim() &&
        typeof item.text === "string" &&
        item.text.trim() &&
        sourceIdList(item.source_ids)
    );
  if (validFlatCandidate) {
    const sections = [];
    for (const item of parsed.items) {
      let section = sections.find(
        (entry) => entry.title === item.section_title
      );
      if (!section) {
        section = { title: item.section_title, source_ids: [], items: [] };
        sections.push(section);
      }
      for (const sourceId of item.source_ids) {
        if (!section.source_ids.includes(sourceId))
          section.source_ids.push(sourceId);
      }
      section.items.push({ text: item.text, source_ids: item.source_ids });
    }
    return {
      summary: {
        text: parsed.summary_text,
        source_ids: parsed.summary_source_ids,
      },
      sections,
    };
  }
  const validSummary =
    parsed?.summary &&
    typeof parsed.summary === "object" &&
    !Array.isArray(parsed.summary) &&
    Object.keys(parsed.summary).every((key) =>
      ["text", "source_ids"].includes(key)
    ) &&
    typeof parsed.summary.text === "string" &&
    parsed.summary.text.trim() &&
    sourceIdList(parsed.summary.source_ids);
  const validSections =
    Array.isArray(parsed?.sections) &&
    parsed.sections.length > 0 &&
    parsed.sections.every(
      (section) =>
        section &&
        typeof section === "object" &&
        !Array.isArray(section) &&
        Object.keys(section).every((key) =>
          ["title", "source_ids", "items"].includes(key)
        ) &&
        typeof section.title === "string" &&
        section.title.trim() &&
        sourceIdList(section.source_ids) &&
        Array.isArray(section.items) &&
        section.items.length > 0 &&
        section.items.every(
          (item) =>
            item &&
            typeof item === "object" &&
            !Array.isArray(item) &&
            Object.keys(item).every((key) =>
              ["text", "source_ids"].includes(key)
            ) &&
            typeof item.text === "string" &&
            item.text.trim() &&
            sourceIdList(item.source_ids)
        )
    );
  if (
    !validSummary ||
    !validSections ||
    Object.keys(parsed).some((key) => !["summary", "sections"].includes(key))
  )
    throw Object.assign(new Error("candidate_schema"), {
      code: "candidate_schema",
    });
  return parsed;
}

function prepareGroundedContract({ question, sources }) {
  const chunks = prepareRetrievedChunks(sources);
  if (chunks.length === 0)
    throw Object.assign(new Error("source_metadata_missing"), {
      code: "source_metadata_missing",
    });

  const sourceUnits = chunks.map((chunk, index) => ({
    source_unit_id: `su${String(index + 1).padStart(3, "0")}`,
    exact_text: chunk.text,
    display_source: {
      document_name: chunk.document_name,
      page: chunk.page,
      section: chunk.section,
      related_image_keys: chunk.related_image_keys,
      image_key: chunk.image_key,
    },
  }));
  const identifiers = sourceUnits.map((unit) => unit.source_unit_id);
  const style = answerStyle(question);
  const statementSchema = {
    type: "object",
    properties: {
      statements: {
        type: "array",
        minItems: 1,
        maxItems: 20,
        items: {
          type: "object",
          properties: {
            text: { type: "string" },
            supporting_source_unit_ids: {
              type: "array",
              minItems: 1,
              maxItems: 8,
              items: { type: "string", enum: identifiers },
            },
          },
          required: ["text", "supporting_source_unit_ids"],
          additionalProperties: false,
        },
      },
    },
    required: ["statements"],
    additionalProperties: false,
  };
  const structuredOutputSchema =
    style === "numbered_steps"
      ? procedurePresentationSchema(identifiers)
      : statementSchema;
  const evidence = sourceUnits
    .map(
      (unit) =>
        `[${unit.source_unit_id}]\n${unit.exact_text}\n[/${unit.source_unit_id}]`
    )
    .join("\n\n");
  const generationPrompt = [
    "당신은 SCHAT 병원 직원용 답변 도우미입니다.",
    "아래에 제공된 SCHAT 근거만 사용하여 질문에 답합니다.",
    "등록된 근거에 없는 사실, 일반 의학지식, 외부 지식을 추가하지 않습니다.",
    "근거가 부족하면 부족하다고 답하고 추측하지 않습니다.",
    "숫자, 시간, 속도, 용량, 조건, 금기와 행위 강도는 근거 표현을 정확히 유지합니다.",
    "질문과 직접 관련된 근거가 여러 개이면 빠뜨리지 말고 충분히 종합합니다.",
    "원문을 그대로 나열하지 말고 자연스러운 한국어로 설명합니다.",
    "절차 질문은 근거의 순서를 유지하고 각 단계를 별도 statement로 작성합니다.",
    "각 statement에는 실제 사용한 SourceUnit ID만 supporting_source_unit_ids에 넣습니다.",
    "요청된 JSON schema 이외의 텍스트나 필드를 출력하지 않습니다.",
    `QUESTION:\n${question}`,
    `SOURCE UNITS:\n${evidence}`,
  ].join("\n\n");

  const procedurePresentationPrompt = [
    "Follow the response schema exactly: summary_text, summary_source_ids, and a flat items array.",
    "Each item contains section_title, text, and source_ids. Repeat section_title for items in the same stage.",
    "Do not output a sections field or nested item arrays.",
    "절차형 표현 규칙:",
    "- summary에는 전체 흐름을 한 문장으로 요약하고 사용한 source_ids를 넣습니다.",
    "- 각 section title은 '첫 번째 단계는' 같은 서술 없이 짧은 단계명만 씁니다.",
    "- 한 item에는 가능한 한 하나의 행동 또는 하나의 사실만 씁니다.",
    "- 문장을 나눌 때 근거에 없는 행동을 추가하거나 기존 조건을 삭제하지 않습니다.",
    "- section과 item은 근거 순서를 유지하고 각각 사용한 source_ids를 넣습니다.",
  ].join("\n");

  return {
    answerStyle: style,
    sourceUnits,
    structuredOutputSchema,
    generationPrompt:
      style === "numbered_steps"
        ? `${generationPrompt}\n\n${procedurePresentationPrompt}`
        : generationPrompt,
  };
}

function finalizeProcedureCandidate(
  prepared,
  candidate,
  relatedImageSources = []
) {
  const publicText = (value) => {
    const text = sanitizeEmployeeAnswer(value);
    if (
      /\bsu\d{3,}\b|source[_ ]?unit|chunk[_ ]?id|document[_ ]?metadata|<svg\b/i.test(
        text
      )
    )
      throw Object.assign(new Error("candidate_internal_identifier"), {
        code: "candidate_internal_identifier",
      });
    return text;
  };
  const allowed = new Map(
    prepared.sourceUnits.map((unit) => [unit.source_unit_id, unit])
  );
  const usedIds = [];
  const registerIds = (sourceIds) => {
    for (const sourceId of sourceIds) {
      if (!allowed.has(sourceId))
        throw Object.assign(new Error("unknown_source_unit"), {
          code: "unknown_source_unit",
        });
      if (!usedIds.includes(sourceId)) usedIds.push(sourceId);
    }
  };
  registerIds(candidate.summary.source_ids);
  for (const section of candidate.sections) {
    registerIds(section.source_ids);
    for (const item of section.items) registerIds(item.source_ids);
  }

  const publicIndex = new Map(
    usedIds.map((sourceId, index) => [sourceId, index + 1])
  );
  const summary = publicText(candidate.summary.text);
  const sections = candidate.sections.map((section) => ({
    title: publicText(section.title),
    items: section.items.map((item) => ({
      text: publicText(item.text),
      sourceIndexes: item.source_ids.map((sourceId) => publicIndex.get(sourceId)),
    })),
  }));
  if (
    !summary ||
    sections.some(
      (section) =>
        !section.title || section.items.some((item) => !item.text)
    )
  )
    throw Object.assign(new Error("candidate_empty"), {
      code: "candidate_empty",
    });

  const text = [
    summary,
    ...sections.flatMap((section, index) => [
      "",
      `${index + 1}단계. ${section.title}`,
      ...section.items.map((item) => `- ${item.text}`),
    ]),
  ].join("\n");
  const usedSources = usedIds.map((sourceId) => {
    const unit = allowed.get(sourceId);
    return { ...unit.display_source, exact_text: unit.exact_text };
  });
  const retrievedSources = prepared.sourceUnits.map(
    (unit) => unit.display_source
  );
  return {
    text,
    presentation: { kind: "procedure", summary, sections },
    sources: normalizeDisplaySources(usedSources),
    relatedImages: collectRelatedImages([
      ...usedSources,
      ...retrievedSources,
      ...relatedImageSources,
    ]),
  };
}

function finalizeGroundedCandidate(
  prepared,
  candidate,
  relatedImageSources = []
) {
  const allowed = new Map(
    prepared.sourceUnits.map((unit) => [unit.source_unit_id, unit])
  );
  const usedIds = [];
  for (const statement of candidate.statements) {
    for (const sourceId of statement.supporting_source_unit_ids) {
      if (!allowed.has(sourceId))
        throw Object.assign(new Error("unknown_source_unit"), {
          code: "unknown_source_unit",
        });
      if (!usedIds.includes(sourceId)) usedIds.push(sourceId);
    }
  }
  const text = formatValidatedAnswer(
    candidate.statements.map((statement) => statement.text).join("\n\n"),
    prepared.answerStyle
  );
  if (!text)
    throw Object.assign(new Error("candidate_empty"), {
      code: "candidate_empty",
    });
  const usedSources = usedIds.map((sourceId) => {
    const unit = allowed.get(sourceId);
    return { ...unit.display_source, exact_text: unit.exact_text };
  });
  const retrievedSources = prepared.sourceUnits.map(
    (unit) => unit.display_source
  );
  return {
    text,
    sources: normalizeDisplaySources(usedSources),
    relatedImages: collectRelatedImages([
      ...usedSources,
      ...retrievedSources,
      ...relatedImageSources,
    ]),
  };
}

async function runGroundedCompletion({
  question,
  sources,
  relatedImageSources = [],
  LLMConnector,
  attachments = [],
  user = null,
  temperature,
}) {
  let prepared;
  let metrics = {};
  try {
    prepared = prepareGroundedContract({ question, sources });
    const safeImageAttachments = validateSafetyImageAttachments(attachments);
    const completion = await LLMConnector.getChatCompletion(
      buildGroundedMultimodalMessages(
        prepared.generationPrompt,
        safeImageAttachments
      ),
      {
        temperature,
        user,
        responseSchema: prepared.structuredOutputSchema,
      }
    );
    metrics = completion?.metrics || {};
    const candidate =
      prepared.answerStyle === "numbered_steps"
        ? parseProcedureCandidate(completion?.textResponse)
        : parseCandidate(completion?.textResponse);
    const finalized =
      prepared.answerStyle === "numbered_steps"
        ? finalizeProcedureCandidate(prepared, candidate, relatedImageSources)
        : finalizeGroundedCandidate(prepared, candidate, relatedImageSources);
    return { ...finalized, metrics };
  } catch (_error) {
    return { text: REFUSAL_TEXT, sources: [], metrics };
  }
}

async function runSafetyGatedCompletion({
  question,
  sources,
  relatedImageSources = [],
  LLMConnector,
  attachments = [],
  user = null,
  temperature,
  safetyClient = createSafetyClient(),
}) {
  const relatedImages = collectRelatedImages([
    ...prepareRetrievedChunks(sources),
    ...relatedImageSources,
  ]);
  let prepared;
  try {
    const retrievedChunks = prepareRetrievedChunks(sources);
    if (retrievedChunks.length === 0) throw new Error("source_metadata_missing");
    prepared = await safetyClient.prepare({
      schema_version: "1",
      request_id: uuidv4(),
      question,
      retrieved_chunks: retrievedChunks,
    });
  } catch (error) {
    return {
      text: REFUSAL_TEXT,
      sources: [],
      metrics: {},
      safety: {
        passed: false,
        usedFallback: false,
        errorCode: error?.code || "safety_prepare_failed",
        retryCount: 0,
      },
    };
  }

  let candidate;
  let metrics = {};
  try {
    const safeImageAttachments = validateSafetyImageAttachments(attachments);
    const completion = await LLMConnector.getChatCompletion(
      buildGroundedMultimodalMessages(
        prepared.generation_prompt,
        safeImageAttachments
      ),
      {
        temperature,
        user,
        responseSchema: prepared.structured_output_schema,
      }
    );
    metrics = completion?.metrics || {};
    candidate = parseCandidate(completion?.textResponse);
  } catch (error) {
    return {
      ...finalizeSafetyDecision({
        prepared,
        validation: null,
        errorCode: error?.code || "candidate_generation_failed",
      }),
      metrics,
    };
  }

  try {
    const validation = await safetyClient.validate({
      schema_version: "1",
      prepared,
      candidate,
    });
    return {
      ...finalizeSafetyDecision({ prepared, validation }),
      relatedImages,
      metrics,
    };
  } catch (error) {
    return {
      ...finalizeSafetyDecision({
        prepared,
        validation: null,
        errorCode: error?.code || "safety_validation_failed",
      }),
      metrics,
    };
  }
}

function runSchatCompletion({ safetyGateEnabled = false, ...options }) {
  return safetyGateEnabled
    ? runSafetyGatedCompletion(options)
    : runGroundedCompletion(options);
}

module.exports = {
  runGroundedCompletion,
  runSafetyGatedCompletion,
  runSchatCompletion,
  prepareGroundedContract,
  prepareRetrievedChunks,
  parseCandidate,
  parseProcedureCandidate,
};
