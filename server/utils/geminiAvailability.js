// Availability only: never changes requests, retrieval, prices, or model settings.
const MESSAGES = Object.freeze({
  exhausted: '현재 AI 사용량이 소진되어 답변할 수 없습니다. 지침서 원본을 확인하시고, 관리자에게 문의해 주세요. 간호교육파트 내선번호 : 6741',
  busy: '사용자가 많아 잠시 후 다시 시도해 주세요.',
  other: 'AI 연결에 문제가 발생했습니다. 잠시 후 다시 시도하거나 관리자에게 문의해 주세요.',
});

function classify(error) {
  const root = error?.response?.data || error?.error || error || {};
  const detail = Array.isArray(root) ? root[0]?.error || root[0] : root.error || root;
  const status = error?.status || error?.response?.status || detail?.code;
  let text = '';
  try { text = JSON.stringify({message: detail?.message || error?.message, details: detail?.details}).slice(0, 32768).toLowerCase(); } catch {}
  if (Number(status) !== 429 && detail?.status !== 'RESOURCE_EXHAUSTED') return 'other';
  if (/perday|per_day|per day|daily (?:quota|limit)|(?:prepaid |credit )?balance (?:is )?(?:exhausted|depleted|insufficient)|insufficient (?:credits|balance)|credits? (?:exhausted|depleted)/.test(text)) return 'exhausted';
  if (/perminute|per_minute|per minute|per \d+ minutes?|persecond|per_second|per second/.test(text)) return 'busy';
  return 'other';
}

function createMonitor(now = Date.now) {
  const alerts = new Map();
  let sequence = 0;
  function failure(error, scope) {
    if (error?.name === 'AbortError' || error?.name === 'APIUserAbortError') return error;
    const kind = classify(error);
    if (kind === 'exhausted') {
      const previous = alerts.get(scope);
      alerts.set(scope, {firstOccurredAt: previous?.firstOccurredAt || new Date(now()).toISOString(), sequence: ++sequence});
    }
    // Do not expose upstream response bodies, request content, credentials or URLs.
    const safe = new Error(MESSAGES[kind]);
    if (error instanceof Error) Object.setPrototypeOf(safe, Object.getPrototypeOf(error));
    if (Number.isInteger(error?.status)) safe.status = error.status;
    safe.schatGeminiKind = kind;
    return safe;
  }
  function success(scope, started) {
    if (alerts.has(scope) && alerts.get(scope).sequence <= started) alerts.delete(scope);
  }
  return {
    snapshot: () => [...alerts.values()].map(({firstOccurredAt}) => ({firstOccurredAt})).sort((a,b)=>a.firstOccurredAt.localeCompare(b.firstOccurredAt)),
    wrap(call, scope) {
      return async (...args) => {
        const started = sequence;
        let result;
        try { result = await call(...args); } catch (error) { throw failure(error, scope); }
        if (result?.[Symbol.asyncIterator]) {
          return new Proxy(result, {
            get(target, key) {
              if (key === Symbol.asyncIterator) return async function* () {
                let finished = false;
                try {
                  for await (const chunk of target) {
                    if (chunk?.choices?.some(choice => !!choice.finish_reason)) {
                      finished = true;
                      if (!target.controller?.signal?.aborted) success(scope, started);
                    }
                    yield chunk;
                  }
                  if (finished && !target.controller?.signal?.aborted) success(scope, started);
                } catch (error) { throw failure(error, scope); }
              };
              const value = Reflect.get(target, key, target);
              return typeof value === 'function' ? value.bind(target) : value;
            },
          });
        }
        if (result?.choices?.length || result?.data?.some(item => Array.isArray(item.embedding))) success(scope, started);
        return result;
      };
    },
  };
}

// Process-local operational state, not chat history. Restart clears this state.
const monitor = createMonitor();
function observeCreate(resource, model, operation, apiKey = '') {
  const identity = require('node:crypto').createHash('sha256').update(apiKey).digest('hex');
  resource.create = monitor.wrap(resource.create.bind(resource), `${identity}:${operation}:${model}`);
}
module.exports = {classify, createMonitor, monitor, observeCreate};
