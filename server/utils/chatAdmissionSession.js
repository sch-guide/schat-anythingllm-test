const { attachAbortSignal } = require("./helpers/abortSignals");

// Both HTTP responses and WebSockets emit close. Register before awaiting
// admission, so a tab closed in the queue cannot later start a generation.
async function openSession(
  gate,
  userId,
  transport,
  { onPosition, onAbort } = {}
) {
  const controller = new AbortController();
  const close = () => controller.abort();
  transport.once("close", close);
  if (
    transport.destroyed ||
    transport.writableEnded ||
    (transport.readyState !== undefined && transport.readyState !== 1)
  )
    close();
  let lease;
  const cleanup = () => transport.removeListener("close", close);
  try {
    lease = await gate.acquire(userId, {
      signal: controller.signal,
      onPosition,
    });
  } catch (error) {
    cleanup();
    throw error;
  }
  const aborted = () => {
    cleanup();
    onAbort?.(lease.signal.reason);
  };
  lease.signal.addEventListener("abort", aborted, { once: true });
  if (lease.signal.aborted) aborted();
  return {
    signal: lease.signal,
    check: () => lease.signal.throwIfAborted(),
    bind: (connector) => {
      attachAbortSignal(connector, lease.signal);
      if (connector?.embedder)
        attachAbortSignal(connector.embedder, lease.signal);
      return connector;
    },
    release: () => {
      cleanup();
      lease.signal.removeEventListener("abort", aborted);
      lease.release();
    },
  };
}

function admissionMessage(code) {
  if (code === "SCHAT_DUPLICATE")
    return "이미 답변을 기다리는 질문이 있습니다. 기존 질문이 끝난 뒤 다시 질문해 주세요.";
  if (code === "SCHAT_QUEUE_FULL" || code === "SCHAT_QUEUE_TIMEOUT")
    return "사용자가 많아 잠시 후 다시 시도해 주세요. (SCHAT 답변 대기)";
  if (code === "SCHAT_GENERATION_TIMEOUT")
    return "답변 시간이 길어져 중단했습니다. 잠시 후 다시 시도해 주세요.";
  return "답변 준비 중 문제가 발생했습니다. 잠시 후 다시 시도해 주세요.";
}

module.exports = { openSession, admissionMessage };
