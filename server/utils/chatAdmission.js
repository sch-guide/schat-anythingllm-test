// Single-process admission control. Callers must bind lease.signal to their
// actual work, and prevent new work after cancellation. No provider/DB access.
function createAdmission({
  setTimer = setTimeout,
  clearTimer = clearTimeout,
} = {}) {
  let maxActive = 4;
  const maxWaiting = 10;
  const entries = new Map();
  const active = new Set();
  const waiting = [];
  const error = (code) => Object.assign(new Error(code), { code });

  function positions() {
    [...waiting].forEach((entry, index) => {
      if (entry.done) return;
      try {
        entry.onPosition?.(index + 1);
      } catch {
        /* disconnected observer */
      }
    });
  }

  function finish(entry, reason) {
    if (entry.done) return;
    entry.done = true;
    clearTimer(entry.timer);
    entry.external?.removeEventListener("abort", entry.disconnect);
    // Notify the running task before allowing a replacement to start.
    if (reason) entry.controller.abort(reason);
    active.delete(entry);
    const index = waiting.indexOf(entry);
    if (index >= 0) waiting.splice(index, 1);
    entries.delete(entry.key);
    if (!entry.started) entry.reject(reason || error("SCHAT_CANCELLED"));
    drain();
  }

  function start(entry) {
    if (entry.done) return;
    clearTimer(entry.timer);
    entry.started = true;
    active.add(entry);
    entry.timer = setTimer(
      () => finish(entry, error("SCHAT_GENERATION_TIMEOUT")),
      80000
    );
    entry.resolve({
      signal: entry.controller.signal,
      release: () => finish(entry),
    });
  }

  function drain() {
    while (active.size < maxActive && waiting.length) start(waiting.shift());
    positions();
  }

  function acquire(userId, { signal, onPosition } = {}) {
    const key = String(userId ?? "").trim();
    if (!key) return Promise.reject(error("SCHAT_IDENTITY_REQUIRED"));
    if (signal?.aborted) return Promise.reject(error("SCHAT_CANCELLED"));
    if (entries.has(key)) return Promise.reject(error("SCHAT_DUPLICATE"));
    if (active.size >= maxActive && waiting.length >= maxWaiting)
      return Promise.reject(error("SCHAT_QUEUE_FULL"));
    return new Promise((resolve, reject) => {
      const entry = {
        key,
        resolve,
        reject,
        onPosition,
        external: signal,
        controller: new AbortController(),
        started: false,
        done: false,
      };
      entry.disconnect = () => finish(entry, error("SCHAT_CANCELLED"));
      entries.set(key, entry);
      signal?.addEventListener("abort", entry.disconnect, { once: true });
      if (active.size < maxActive && waiting.length === 0) start(entry);
      else {
        waiting.push(entry);
        entry.timer = setTimer(
          () => finish(entry, error("SCHAT_QUEUE_TIMEOUT")),
          15000
        );
        positions();
      }
    });
  }

  function configure({ maxActive: value }) {
    if (!Number.isSafeInteger(value) || value < 1 || value > 16)
      throw error("SCHAT_INVALID_LIMIT");
    maxActive = value;
    drain();
  }

  return {
    acquire,
    configure,
    snapshot: () => ({
      active: active.size,
      waiting: waiting.length,
      maxActive,
      maxWaiting,
    }),
  };
}

module.exports = { createAdmission };
