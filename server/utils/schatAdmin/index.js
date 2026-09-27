// Read-only helpers behind the SCHAT admin screen ("시스템 상태", "시스템 연결").
// Nothing here changes documents, vectors, checklists or provider settings.

const GEMINI_MODELS_URL =
  "https://generativelanguage.googleapis.com/v1beta/models";

// Stored page documents look like "<file>.pdf-page-12-<uuid>.json"; every page
// of one PDF counts as a single registered file.
function summarizeDocuments(docpaths = []) {
  const files = new Set();
  for (const docpath of docpaths) {
    if (typeof docpath !== "string" || !docpath) continue;
    files.add(docpath.replace(/\.pdf-page-\d+-[^/]*$/iu, ".pdf"));
  }
  return { files: files.size, pages: docpaths.length };
}

function summarizeChecklists(checklists = []) {
  let active = 0;
  let review = 0;
  for (const checklist of checklists) {
    if (checklist?.status === "needs_review" || checklist?.active === false)
      review += 1;
    else active += 1;
  }
  return { total: active + review, active, review };
}

const CONNECTION_MESSAGES = {
  missing_key: "API 키가 등록되어 있지 않습니다.",
  missing_model: "사용 모델이 설정되어 있지 않습니다.",
  ok: "연결되었습니다.",
  unauthorized: "API 키가 올바르지 않거나 권한이 없습니다.",
  not_found: "API 키는 확인되었지만 설정된 모델을 찾을 수 없습니다.",
  rate_limited: "요청이 많아 잠시 후 다시 시도해야 합니다.",
  timeout: "응답 시간이 초과되었습니다.",
  failed: "연결을 확인하지 못했습니다.",
};

function connectionResult(code, status = null) {
  return {
    ok: code === "ok",
    code,
    status,
    message: CONNECTION_MESSAGES[code] || CONNECTION_MESSAGES.failed,
  };
}

/**
 * Looks up the configured model's metadata with the stored key. Sends only the
 * key (as a header) and the model name - never hospital text - and never
 * returns or logs the key.
 */
async function checkGeminiConnection({
  apiKey,
  model,
  fetchImpl = globalThis.fetch,
  timeoutMs = 8000,
} = {}) {
  if (!apiKey) return connectionResult("missing_key");
  if (!model) return connectionResult("missing_model");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const name = String(model).replace(/^models\//u, "");
    const response = await fetchImpl(
      `${GEMINI_MODELS_URL}/${encodeURIComponent(name)}`,
      {
        method: "GET",
        headers: { "x-goog-api-key": apiKey },
        signal: controller.signal,
      }
    );
    if (response.ok) return connectionResult("ok", response.status);
    if ([400, 401, 403].includes(response.status))
      return connectionResult("unauthorized", response.status);
    if (response.status === 404)
      return connectionResult("not_found", response.status);
    if (response.status === 429)
      return connectionResult("rate_limited", response.status);
    return connectionResult("failed", response.status);
  } catch (error) {
    return connectionResult(
      error?.name === "AbortError" ? "timeout" : "failed"
    );
  } finally {
    clearTimeout(timer);
  }
}

function connectionTargets(env = process.env) {
  return {
    llm: {
      provider: env.LLM_PROVIDER || null,
      model: env.GEMINI_LLM_MODEL_PREF || null,
      keySet: !!env.GEMINI_API_KEY,
      apiKey: env.GEMINI_API_KEY || null,
    },
    embedding: {
      provider: env.EMBEDDING_ENGINE || null,
      model: env.EMBEDDING_MODEL_PREF || null,
      keySet: !!env.GEMINI_EMBEDDING_API_KEY,
      apiKey: env.GEMINI_EMBEDDING_API_KEY || null,
    },
  };
}

// Same as connectionTargets but safe to send to the browser.
function publicConnectionState(env = process.env) {
  const targets = connectionTargets(env);
  const strip = ({ apiKey: _apiKey, ...rest }) => rest;
  return {
    llm: strip(targets.llm),
    embedding: strip(targets.embedding),
    // Only whether the two keys are identical, never the keys themselves.
    sharedKey:
      !!targets.llm.apiKey && targets.llm.apiKey === targets.embedding.apiKey,
  };
}

module.exports = {
  summarizeDocuments,
  summarizeChecklists,
  checkGeminiConnection,
  connectionTargets,
  publicConnectionState,
};
