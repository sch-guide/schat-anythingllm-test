class SafetyEvaluatorError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

function createSafetyClient({
  baseUrl = process.env.SCHAT_SAFETY_EVALUATOR_URL,
  timeoutMs = Number(process.env.SCHAT_SAFETY_TIMEOUT_MS || 3000),
  fetchImpl = globalThis.fetch,
} = {}) {
  if (!baseUrl || typeof fetchImpl !== "function")
    throw new SafetyEvaluatorError("safety_evaluator_configuration");

  async function call(path, payload, validateShape) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(`${baseUrl}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      if (!response?.ok)
        throw new SafetyEvaluatorError("safety_evaluator_http");
      const result = await response.json();
      if (!validateShape(result))
        throw new SafetyEvaluatorError("safety_evaluator_response");
      return result;
    } catch (error) {
      if (error instanceof SafetyEvaluatorError) throw error;
      if (controller.signal.aborted)
        throw new SafetyEvaluatorError("safety_evaluator_timeout");
      throw new SafetyEvaluatorError("safety_evaluator_unavailable");
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    prepare(payload) {
      return call(
        "/v1/prepare",
        payload,
        (value) =>
          typeof value?.contract_id === "string" &&
          typeof value?.generation_prompt === "string" &&
          Array.isArray(value?.source_units) &&
          typeof value?.fallback?.text === "string"
      );
    },
    validate(payload) {
      return call(
        "/v1/validate",
        payload,
        (value) =>
          ["PASS", "FAIL"].includes(value?.decision) &&
          value?.retry_count === 0 &&
          typeof value?.display_output?.text === "string"
      );
    },
  };
}

module.exports = { createSafetyClient, SafetyEvaluatorError };
