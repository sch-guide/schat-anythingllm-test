import { useCallback, useEffect, useState } from "react";
import useUser from "@/hooks/useUser";
import { AUTH_TOKEN } from "@/utils/constants";
import {
  checklistMemoKey,
  checklistMemoPrefix,
  loadChecklistMemo,
  memoSessionId,
  purgeChecklistMemos,
  saveChecklistMemo,
} from "@/utils/checklistMemo";

function browserStorage() {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

function currentSessionId() {
  try {
    return memoSessionId(browserStorage()?.getItem(AUTH_TOKEN));
  } catch {
    return memoSessionId(null);
  }
}

function readSaved(key) {
  return { key, ...loadChecklistMemo(browserStorage(), key) };
}

/**
 * 환자정보 / 기타메모 of one checklist for the current user and login
 * session, shared by the floating panel and the separate window. Browser
 * only: nothing here is sent to the server.
 */
export default function useChecklistMemo(checklistId) {
  const { user } = useUser();
  const sessionId = currentSessionId();
  const prefix = checklistMemoPrefix(user?.id, sessionId);
  const key = checklistMemoKey(user?.id, sessionId, checklistId);
  const [state, setState] = useState(() => readSaved(key));
  const saved = state.key === key ? state : readSaved(key);

  // Opening a checklist clears notes of other users, earlier sessions and
  // expired ones from this browser.
  useEffect(() => {
    purgeChecklistMemos(browserStorage(), prefix);
    setState(readSaved(key));
  }, [prefix, key]);

  useEffect(() => {
    const sync = (event) => {
      if (event.key === key || event.key === null) setState(readSaved(key));
    };
    window.addEventListener("storage", sync);
    return () => window.removeEventListener("storage", sync);
  }, [key]);

  const setMemoField = useCallback(
    (field, value) => {
      setState((current) => {
        const base = current.key === key ? current : readSaved(key);
        const next = { ...base, key, [field]: value, updatedAt: Date.now() };
        saveChecklistMemo(browserStorage(), key, next, next.updatedAt);
        return next;
      });
    },
    [key]
  );

  return {
    patientInfo: saved.patient,
    otherMemo: saved.other,
    setMemoField,
  };
}
