import { useEffect, useState } from "react";

/**
 * Keeps internal agent/tool activity out of the employee-facing chat while
 * still showing that SCHAT is working on the answer.
 */
export default function StatusResponse({ isThinking = false }) {
  const [elapsed, setElapsed] = useState(1);

  useEffect(() => {
    if (!isThinking) return undefined;

    const timer = window.setInterval(
      () => setElapsed((value) => value + 1),
      1_000,
    );
    return () => window.clearInterval(timer);
  }, [isThinking]);

  if (!isThinking) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="w-full py-4 text-sm font-medium text-zinc-400 light:text-slate-500"
    >
      답변 생성 중 · {elapsed}초
    </div>
  );
}
