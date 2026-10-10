import { useCallback, useEffect, useState } from "react";
import useUser from "@/hooks/useUser";
import {
  checklistChecksKey,
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

/**
 * Checkbox state of one checklist, shared by the floating panel and the
 * separate window. It survives closing/reopening and reloads, and a change in
 * one window shows up in the other through the browser "storage" event.
 */
export default function useChecklistChecks(checklistId) {
  const { user } = useUser();
  const key = checklistChecksKey(user?.id, checklistId);
  const [state, setState] = useState(() => ({
    key,
    checked: loadChecklistChecks(browserStorage(), key),
  }));
  // Another user or checklist: read that one's saved checks.
  const checkedItems =
    state.key === key
      ? state.checked
      : loadChecklistChecks(browserStorage(), key);

  useEffect(() => {
    if (state.key !== key)
      setState({ key, checked: loadChecklistChecks(browserStorage(), key) });
  }, [key, state.key]);

  useEffect(() => {
    const sync = (event) => {
      if (event.key !== key) return;
      setState({ key, checked: loadChecklistChecks(browserStorage(), key) });
    };
    window.addEventListener("storage", sync);
    return () => window.removeEventListener("storage", sync);
  }, [key]);

  const setCheckedItems = useCallback(
    (next) => {
      saveChecklistChecks(browserStorage(), key, next);
      setState({ key, checked: next });
    },
    [key]
  );
  const resetCheckedItems = useCallback(
    () => setCheckedItems({}),
    [setCheckedItems]
  );

  return { checkedItems, setCheckedItems, resetCheckedItems };
}
