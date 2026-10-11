import { useCallback, useEffect, useState } from "react";
import useUser from "@/hooks/useUser";
import {
  checklistChecksKey,
  hasChecks,
  loadChecklistChecks,
  saveChecklistChecks,
} from "@/utils/checklistChecks";

function browserStorage() {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

function readSaved(key) {
  return { key, ...loadChecklistChecks(browserStorage(), key) };
}

/**
 * Checkbox state of one checklist, shared by the floating panel and the
 * separate window. It survives closing/reopening and reloads, and a change in
 * one window shows up in the other through the browser "storage" event.
 *
 * leftover: when the checklist is opened with checks already saved, the time
 * of that last change ({ updatedAt }) so the screen can warn before the next
 * patient. Checks are never cleared automatically.
 */
export default function useChecklistChecks(checklistId, isOpen = true) {
  const { user } = useUser();
  const key = checklistChecksKey(user?.id, checklistId);
  const [state, setState] = useState(() => readSaved(key));
  // Another user or checklist: read that one's saved checks.
  const saved = state.key === key ? state : readSaved(key);
  const [leftover, setLeftover] = useState(null);

  useEffect(() => {
    if (state.key !== key) setState(readSaved(key));
  }, [key, state.key]);

  useEffect(() => {
    const sync = (event) => {
      if (event.key === key) setState(readSaved(key));
    };
    window.addEventListener("storage", sync);
    return () => window.removeEventListener("storage", sync);
  }, [key]);

  // Snapshot at the moment the checklist is opened, not on every change.
  useEffect(() => {
    if (!isOpen) return setLeftover(null);
    const current = readSaved(key);
    setLeftover(
      hasChecks(current.checks) ? { updatedAt: current.updatedAt } : null
    );
  }, [isOpen, key]);

  const setCheckedItems = useCallback(
    (next) => {
      const now = Date.now();
      saveChecklistChecks(browserStorage(), key, next, now);
      setState({ key, checks: next, updatedAt: now });
    },
    [key]
  );
  const resetCheckedItems = useCallback(
    () => setCheckedItems({}),
    [setCheckedItems]
  );
  const dismissLeftover = useCallback(() => setLeftover(null), []);

  return {
    checkedItems: saved.checks,
    setCheckedItems,
    resetCheckedItems,
    // Nothing left to warn about once every check is cleared.
    leftover: hasChecks(saved.checks) ? leftover : null,
    dismissLeftover,
  };
}
