const { v4: uuidv4 } = require("uuid");
const { createSafetyClient } = require("./client");
const {
  finalizeSafetyDecision,
  normalizePage,
  sanitizeDisplayText,
  REFUSAL_TEXT,
} = require("./finalize");

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

async function runSafetyGatedCompletion({
  question,
  sources,
  LLMConnector,
  user = null,
  temperature,
  safetyClient = createSafetyClient(),
}) {
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
    const completion = await LLMConnector.getChatCompletion(
      [{ role: "user", content: prepared.generation_prompt }],
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
    return { ...finalizeSafetyDecision({ prepared, validation }), metrics };
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

module.exports = { runSafetyGatedCompletion, prepareRetrievedChunks, parseCandidate };
