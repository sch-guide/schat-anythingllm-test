import { useEffect, useRef, useState } from "react";
import {
  AUTO_STOP_SECONDS,
  SLOW_NOTICE_SECONDS,
  SLOW_NOTICE_TEXT,
  STOPPED_TEXT,
  WAITING_PHASE_LABELS,
} from "@/utils/schatWaitingStatus";

/**
 * Keeps internal agent/tool activity out of the employee-facing chat while
 * still showing which step SCHAT is on ("문서를 찾는 중…" …), a notice after
 * 20 seconds, a spinning indicator, and an automatic stop after 70 seconds.
 */
export default function StatusResponse({
  isThinking = false,
  phase = "search",
  onStop = null,
  // When this question was sent. Kept by the chat history so the count does
  // not restart when the question's message is updated during the run.
  startedAt = null,
}) {
  const [mountedAt] = useState(() => Date.now());
  const [now, setNow] = useState(mountedAt);
  const stoppedRef = useRef(false);
  const since = startedAt || mountedAt;
  // Counted only for the 20-second notice and the 70-second stop; the
  // seconds themselves are not shown to staff.
  const elapsed = Math.max(1, Math.floor((now - since) / 1000) + 1);

  useEffect(() => {
    if (!isThinking) return undefined;

    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [isThinking]);

  useEffect(() => {
    if (!isThinking || stoppedRef.current) return;
    if (elapsed >= AUTO_STOP_SECONDS) {
      stoppedRef.current = true;
      onStop?.("timeout");
    }
  }, [elapsed, isThinking, onStop]);

  if (!isThinking) return null;

  const label = WAITING_PHASE_LABELS[phase] || WAITING_PHASE_LABELS.search;
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex w-full flex-col gap-1 py-4 text-sm font-medium text-zinc-400 light:text-slate-500"
      data-schat-waiting={phase}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span>{label}</span>
        <span
          aria-hidden="true"
          className="inline-block h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-current border-t-transparent"
        />
      </div>
      {elapsed >= SLOW_NOTICE_SECONDS && (
        <p className="m-0 text-xs text-amber-400 light:text-amber-700">
          {SLOW_NOTICE_TEXT}
        </p>
      )}
    </div>
  );
}

/** Shown in place of an answer after [멈추기] or the automatic stop. */
export function StoppedNotice({ reason = "user", onRetry = null }) {
  return (
    <div
      role="status"
      className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 py-4 text-sm text-zinc-300 light:text-slate-600"
      data-schat-stopped={reason}
    >
      <span>{STOPPED_TEXT[reason] || STOPPED_TEXT.user}</span>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="rounded-md border border-sky-500 px-2 py-0.5 text-xs font-semibold text-sky-300 hover:bg-sky-500/10 light:text-sky-700"
        >
          다시 시도
        </button>
      )}
    </div>
  );
}
