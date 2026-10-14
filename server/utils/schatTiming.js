// SCHAT 단계별 소요 시간 기록.
// - 질문 원문·근거 문장·개인정보는 남기지 않고 단계 이름과 ms만 서버 로그에 남긴다.
// - SCHAT_TIMING_LOG=off 로 끌 수 있다(기본 켜짐).
const { performance } = require("perf_hooks");

function timingEnabled(env = process.env) {
  return String(env.SCHAT_TIMING_LOG || "on").toLowerCase() !== "off";
}

function formatTiming(scope, values = {}) {
  const parts = Object.entries(values)
    .filter(([, value]) => value !== undefined && value !== null)
    .map(([key, value]) => `${key}=${value}`);
  return `[SCHAT timing] ${scope} ${parts.join(" ")}`.trim();
}

/**
 * Small stopwatch. `mark(name)` records the time since the previous mark,
 * `since(start)` measures one independent (parallel) step, `done()` logs once.
 */
function startTimer(scope, { log = console.log, now = () => performance.now() } = {}) {
  const startedAt = now();
  let last = startedAt;
  const values = {};
  return {
    now,
    mark(name) {
      const current = now();
      values[name] = Math.round(current - last);
      last = current;
      return values[name];
    },
    set(name, value) {
      values[name] = value;
    },
    since(name, start) {
      values[name] = Math.round(now() - start);
      return values[name];
    },
    elapsed() {
      return Math.round(now() - startedAt);
    },
    done(extra = {}) {
      const result = { ...values, ...extra, total: Math.round(now() - startedAt) };
      if (timingEnabled()) log(formatTiming(scope, result));
      return result;
    },
  };
}

module.exports = { startTimer, formatTiming, timingEnabled };
