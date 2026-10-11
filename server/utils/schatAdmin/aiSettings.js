const crypto = require("node:crypto");
const {
  checkGeminiConnection,
  connectionTargets,
  publicConnectionState,
} = require("./index");

const MODELS_URL = "https://generativelanguage.googleapis.com/v1beta/models";
const MODEL_NAME = /^gemini-[a-zA-Z0-9._-]+$/u;
const MESSAGES = {
  forbidden: "관리자만 AI 설정을 바꿀 수 있습니다.",
  invalid: "모델과 열쇠 입력을 확인해 주세요.",
  conflict:
    "다른 설정 변경이 진행되었거나 진행 중입니다. 화면을 다시 열어 주세요.",
  unavailable: "모델 목록을 확인하지 못했습니다. 이전 설정을 유지합니다.",
  failed: "연결을 확인하지 못해 저장하지 않았습니다. 이전 설정을 유지합니다.",
  timeout:
    "연결 확인 시간이 초과되어 저장하지 않았습니다. 이전 설정을 유지합니다.",
  saved: "연결을 확인하고 AI 설정을 저장했습니다.",
  storage_failed:
    "현재 설정은 유지합니다. 설정 파일 복구를 확인하지 못했으므로 서버를 다시 시작하기 전에 기술 담당자에게 알려 주세요.",
};

// A single server process owns its settings. The opaque version also prevents
// an old editor from overwriting a newer save; it never exposes a key digest.
function createAiSettingsApi({
  env = process.env,
  fetchImpl = globalThis.fetch,
  timeoutMs = 5000,
  body = (request) => request.body,
  persist = (values, userId) =>
    require("../helpers/updateENV").updateENV(values, false, userId, {
      atomicDump: true,
    }),
} = {}) {
  let saving = false;
  const versionSecret = crypto.randomBytes(32);
  const revision = () =>
    crypto
      .createHmac("sha256", versionSecret)
      .update(
        JSON.stringify([
          connectionTargets(env),
          env.GEMINI_EMBEDDING_API_KEY || null,
        ])
      )
      .digest("base64url");
  const reply = (response, code, reason, extra = {}) =>
    response.status(code).json({
      ok: reason === "saved",
      code: reason,
      message: MESSAGES[reason],
      ...extra,
    });
  const allowed = (response) =>
    response.locals?.multiUserMode === false ||
    response.locals?.user?.role === "admin";
  function candidateKey(input, stored) {
    if (input == null || input === "") return stored;
    if (typeof input !== "string") return null;
    const key = input.trim();
    if (!key) return stored;
    return key.length <= 512 && /^[a-zA-Z0-9_-]+$/u.test(key) ? key : null;
  }

  async function listModels(apiKey) {
    if (!apiKey) throw Error("unavailable");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const models = new Set();
      const tokens = new Set();
      let pageToken = "";
      do {
        const url = new URL(MODELS_URL);
        url.searchParams.set("pageSize", "1000");
        if (pageToken) url.searchParams.set("pageToken", pageToken);
        const result = await fetchImpl(url.toString(), {
          method: "GET",
          headers: { "x-goog-api-key": apiKey },
          signal: controller.signal,
        });
        if (!result.ok) throw Error("unavailable");
        const data = await result.json();
        if (!Array.isArray(data?.models)) throw Error("unavailable");
        for (const entry of data.models) {
          const name =
            typeof entry?.name === "string"
              ? entry.name.replace(/^models\//u, "")
              : "";
          if (
            MODEL_NAME.test(name) &&
            !name.includes(apiKey) &&
            Array.isArray(entry.supportedGenerationMethods) &&
            entry.supportedGenerationMethods.includes("generateContent")
          )
            models.add(name);
        }
        pageToken = data.nextPageToken || "";
        if (
          typeof pageToken !== "string" ||
          tokens.has(pageToken) ||
          tokens.size >= 20
        )
          throw Error("unavailable");
        if (pageToken) tokens.add(pageToken);
      } while (pageToken);
      if (!models.size) throw Error("unavailable");
      return [...models].sort();
    } finally {
      clearTimeout(timer);
    }
  }

  async function models(request, response) {
    if (!allowed(response)) return reply(response, 403, "forbidden");
    try {
      const input = body(request) || {};
      if (input.revision && input.revision !== revision())
        return reply(response, 409, "conflict");
      const key = candidateKey(input.apiKey, connectionTargets(env).llm.apiKey);
      if (!key) return reply(response, 400, "invalid");
      const before = revision();
      const available = await listModels(key);
      if (before !== revision()) return reply(response, 409, "conflict");
      return response
        .status(200)
        .json({ ok: true, models: available, revision: before });
    } catch (error) {
      return reply(
        response,
        503,
        error?.name === "AbortError" ? "timeout" : "unavailable"
      );
    }
  }

  async function save(request, response) {
    if (!allowed(response)) return reply(response, 403, "forbidden");
    if (saving) return reply(response, 409, "conflict");
    let input;
    try {
      input = body(request) || {};
    } catch {
      return reply(response, 400, "invalid");
    }
    const target = input.target || "llm";
    const targets = connectionTargets(env);
    const current = targets[target];
    if (
      !["llm", "embedding"].includes(target) ||
      current?.provider !== "gemini" ||
      typeof input.model !== "string" ||
      !MODEL_NAME.test(input.model) ||
      (target === "embedding" && input.model !== current.model)
    )
      return reply(response, 400, "invalid");
    const key = candidateKey(input.apiKey, current.apiKey);
    if (!key) return reply(response, 400, "invalid");
    if (input.revision !== revision()) return reply(response, 409, "conflict");
    saving = true;
    try {
      if (target === "llm") {
        let available;
        try {
          available = await listModels(key);
        } catch (error) {
          return reply(
            response,
            503,
            error?.name === "AbortError" ? "timeout" : "unavailable"
          );
        }
        if (!available.includes(input.model))
          return reply(response, 400, "invalid");
      }
      const tested = await checkGeminiConnection({
        apiKey: key,
        model: input.model,
        fetchImpl,
        timeoutMs,
      });
      if (!tested.ok)
        return reply(
          response,
          503,
          tested.code === "timeout" ? "timeout" : "failed"
        );
      if (input.revision !== revision())
        return reply(response, 409, "conflict");
      const changes =
        target === "llm" ? { GeminiLLMModelPref: input.model } : {};
      if (key !== current.apiKey)
        changes[
          target === "llm" ? "GeminiLLMApiKey" : "GeminiEmbeddingApiKey"
        ] = key;
      // GeminiEmbedder falls back to the answer key. Pin its previous effective
      // key before changing the answer key so one change cannot affect search.
      if (
        target === "llm" &&
        key !== current.apiKey &&
        !env.GEMINI_EMBEDDING_API_KEY &&
        current.apiKey
      )
        changes.GeminiEmbeddingApiKey = current.apiKey;
      // The existing writer never records these values in event metadata. Its
      // returned newValues can contain keys, so it must never reach the client.
      const before = { ...env };
      try {
        const result = await persist(changes, response.locals?.user?.id);
        if (result?.error) throw Error("save-failed");
      } catch (error) {
        // updateENV may update process.env before a disk write fails.
        for (const name of [
          "GEMINI_LLM_MODEL_PREF",
          "GEMINI_API_KEY",
          "GEMINI_EMBEDDING_API_KEY",
        ]) {
          if (before[name] === undefined) delete env[name];
          else env[name] = before[name];
        }
        return reply(
          response,
          503,
          error?.code === "ENV_RESTORE_FAILED" ? "storage_failed" : "failed"
        );
      }
      return reply(response, 200, "saved", {
        connections: publicConnectionState(env),
        revision: revision(),
      });
    } catch {
      return reply(response, 503, "failed");
    } finally {
      saving = false;
    }
  }

  function read(_request, response) {
    if (!allowed(response)) return reply(response, 403, "forbidden");
    response.set?.("Cache-Control", "no-store");
    return response.status(200).json({
      ok: true,
      connections: publicConnectionState(env),
      revision: revision(),
    });
  }
  return { read, models, save, revision };
}

module.exports = { createAiSettingsApi };
