// Availability only: never changes requests, retrieval, prices, or model settings.
const MESSAGES = Object.freeze({
  exhausted:
    "현재 AI 사용량이 소진되어 답변할 수 없습니다. 지침서 원본을 확인하시고, 관리자에게 문의해 주세요. 간호교육파트 내선번호 : 6741",
  busy: "사용자가 많아 잠시 후 다시 시도해 주세요.",
  other:
    "답변 생성 중 문제가 발생했습니다. 잠시 후 다시 시도해 주세요. 계속 문제가 발생하면 관리자에게 문의해 주세요.",
});

function classify(error) {
  const root = error?.response?.data || error?.error || error || {};
  const detail = Array.isArray(root)
    ? root[0]?.error || root[0]
    : root.error || root;
  const status = error?.status || error?.response?.status || detail?.code;
  let text = "";
  try {
    text = JSON.stringify({
      message: detail?.message || error?.message,
      details: detail?.details,
      reason: detail?.reason,
      code: detail?.code,
    })
      .slice(0, 32768)
      .toLowerCase();
  } catch {}
  if (
    ![402, 429].includes(Number(status)) &&
    detail?.status !== "RESOURCE_EXHAUSTED"
  )
    return "other";
  if (
    /perday|per_day|per day|permonth|per_month|per month|(?:daily|monthly) (?:quota|limit)|(?:prepaid |credit )?balance (?:is )?(?:exhausted|depleted|insufficient)|insufficient (?:credits|balance)|credits? (?:are |is )?(?:exhausted|depleted)|billing[_ ](?:quota|limit)[_ ]exceeded/.test(
      text
    )
  )
    return "exhausted";
  if (
    /perminute|per_minute|per minute|per \d+ minutes?|persecond|per_second|per second/.test(
      text
    )
  )
    return "busy";
  // Retry-After / RetryInfo can support a temporary limit, but never override
  // explicit long-lived exhaustion. Ambiguous 429 is deliberately non-exhausted.
  return Number(status) === 429 || detail?.status === "RESOURCE_EXHAUSTED"
    ? "busy"
    : "other";
}

function createMonitor(now = Date.now, { storage } = {}) {
  let state = {
    status: "unknown",
    firstOccurredAt: null,
    lastSuccessAt: null,
    lastErrorAt: null,
    lastErrorKind: null,
    busyCount: 0,
  };
  let loaded = !storage,
    loading,
    queue = Promise.resolve(),
    persistenceError = false;
  let observedBeforeLoad = false;
  let recoveredBeforeLoad = false;
  let sequence = 0;
  async function ready() {
    if (loaded) return;
    if (!loading)
      loading = (async () => {
        try {
          const saved = await storage.load();
          if (saved && !observedBeforeLoad) {
            for (const key of [
              "firstOccurredAt",
              "lastSuccessAt",
              "lastErrorAt",
            ])
              state[key] =
                typeof saved[key] === "string" &&
                Number.isFinite(Date.parse(saved[key]))
                  ? saved[key]
                  : null;
            state.status = ["normal", "busy", "exhausted", "other"].includes(
              saved.status
            )
              ? saved.status
              : "unknown";
            state.lastErrorKind = ["busy", "exhausted", "other"].includes(
              saved.lastErrorKind
            )
              ? saved.lastErrorKind
              : null;
            state.busyCount =
              Number.isSafeInteger(saved.busyCount) && saved.busyCount >= 0
                ? saved.busyCount
                : 0;
          }
          if (
            saved &&
            observedBeforeLoad &&
            !recoveredBeforeLoad &&
            state.status !== "normal" &&
            typeof saved.firstOccurredAt === "string" &&
            Number.isFinite(Date.parse(saved.firstOccurredAt))
          ) {
            state.firstOccurredAt =
              state.firstOccurredAt &&
              state.firstOccurredAt < saved.firstOccurredAt
                ? state.firstOccurredAt
                : saved.firstOccurredAt;
            state.status = "exhausted";
          }
          loaded = true;
          persistenceError = false;
          if (observedBeforeLoad) {
            await persist(
              state.firstOccurredAt && !saved?.firstOccurredAt
                ? "schat_gemini_exhausted"
                : saved?.firstOccurredAt && state.status === "normal"
                  ? "schat_gemini_recovered"
                  : null
            );
            observedBeforeLoad = false;
          }
        } catch {
          persistenceError = true;
        } finally {
          loading = null;
        }
      })();
    await loading;
  }
  async function persist(event) {
    if (!storage || !loaded) return;
    const saved = { ...state };
    queue = queue.then(async () => {
      try {
        await storage.save(saved);
        if (event && storage.event)
          await storage.event(event, { kind: saved.lastErrorKind || "normal" });
        persistenceError = false;
      } catch {
        persistenceError = true;
      }
    });
    await queue;
  }
  async function failure(error) {
    if (error?.name === "AbortError" || error?.name === "APIUserAbortError")
      return error;
    const kind = classify(error);
    if (!loaded) observedBeforeLoad = true;
    sequence++;
    const at = new Date(now()).toISOString();
    let event;
    if (kind === "exhausted") {
      if (!state.firstOccurredAt) event = "schat_gemini_exhausted";
      state.firstOccurredAt ||= at;
    }
    state.status = state.firstOccurredAt ? "exhausted" : kind;
    state.lastErrorKind = kind;
    state.lastErrorAt = at;
    state.busyCount = kind === "busy" ? state.busyCount + 1 : 0;
    if (state.busyCount === 3) event = "schat_gemini_busy_repeated";
    await persist(event);
    // Do not expose upstream response bodies, request content, credentials or URLs.
    const safe = new Error(MESSAGES[kind]);
    if (error instanceof Error)
      Object.setPrototypeOf(safe, Object.getPrototypeOf(error));
    if (Number.isInteger(error?.status)) safe.status = error.status;
    safe.schatGeminiKind = kind;
    return safe;
  }
  async function success(started) {
    if (!loaded) observedBeforeLoad = true;
    state.lastSuccessAt = new Date(now()).toISOString();
    const recovered = state.firstOccurredAt && sequence <= started;
    if (sequence <= started) {
      state.status = "normal";
      state.firstOccurredAt = null;
      state.busyCount = 0;
      if (!loaded) recoveredBeforeLoad = true;
    }
    await persist(recovered ? "schat_gemini_recovered" : null);
  }
  return {
    getState: async () => {
      await ready();
      await queue;
      return { ...state, persistenceError };
    },
    snapshot: () =>
      state.firstOccurredAt ? [{ firstOccurredAt: state.firstOccurredAt }] : [],
    wrap(call, scope) {
      return async (...args) => {
        await ready();
        const started = sequence;
        let result;
        try {
          result = await call(...args);
        } catch (error) {
          throw await failure(error);
        }
        if (result?.[Symbol.asyncIterator]) {
          return new Proxy(result, {
            get(target, key) {
              if (key === Symbol.asyncIterator)
                return async function* () {
                  let finished = false;
                  try {
                    for await (const chunk of target) {
                      if (
                        chunk?.choices?.some((choice) => !!choice.finish_reason)
                      ) {
                        finished = true;
                        if (!target.controller?.signal?.aborted)
                          await success(started);
                      }
                      yield chunk;
                    }
                  } catch (error) {
                    throw await failure(error);
                  }
                };
              const value = Reflect.get(target, key, target);
              return typeof value === "function" ? value.bind(target) : value;
            },
          });
        }
        if (
          result?.choices?.length ||
          result?.data?.some((item) => Array.isArray(item.embedding))
        )
          await success(started);
        return result;
      };
    },
  };
}

// Lazy storage dependencies keep isolated tests independent of the live DB.
const monitor = createMonitor(Date.now, {
  storage: {
    load: () => require("./geminiSettings").readSetting("schat_gemini_state"),
    save: (state) =>
      require("./geminiSettings").writeSetting("schat_gemini_state", state),
    event: (name, data) => require("./geminiSettings").recordEvent(name, data),
  },
});
function observeCreate(resource, model, operation, apiKey = "") {
  const identity = require("node:crypto")
    .createHash("sha256")
    .update(apiKey)
    .digest("hex");
  resource.create = monitor.wrap(
    resource.create.bind(resource),
    `${identity}:${operation}:${model}`
  );
}
module.exports = { classify, createMonitor, monitor, observeCreate };
