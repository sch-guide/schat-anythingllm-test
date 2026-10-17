import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import useUser from "@/hooks/useUser";
import { API_BASE, AUTH_TOKEN } from "@/utils/constants";
import { baseHeaders } from "@/utils/request";
import {
  createPopupSession,
  popupStorageKey,
  readPopupSnapshot,
} from "@/utils/checklistPopupSession";
import {
  createPersonalSession,
  clearLegacyChecklistCopies,
  clearExpiredLocalNames,
  createLocalNames,
  localNamesKey,
} from "@/utils/checklistPersonalSession";

const blank = () => ({
  checks: {},
  patient: "",
  other: "",
  ready: false,
  error: null,
  expiresAt: null,
});
export default function useChecklistPersonalState(
  checklistId,
  isOpen = true,
  popup = false
) {
  const { slug } = useParams();
  const { user } = useUser();
  const identity = `${popup ? "popup" : user?.id}:${slug}:${checklistId}`;
  const [state, setState] = useState(() =>
    popup
      ? readPopupSnapshot(
          window.localStorage,
          popupStorageKey(slug, checklistId),
          window.localStorage.getItem(AUTH_TOKEN)
            ? String(user?.id || "")
            : null
        ) || blank()
      : blank()
  );
  const [leftover, setLeftover] = useState(null);
  const sessionRef = useRef(null);
  const timer = useRef(null);
  const [loadedIdentity, setLoadedIdentity] = useState(identity);
  const visible = loadedIdentity === identity ? state : blank();
  useEffect(() => {
    clearLegacyChecklistCopies(window.localStorage);
    clearExpiredLocalNames(window.localStorage);
    if (!popup) setState(blank());
    setLoadedIdentity(identity);
    setLeftover(null);
    if ((!popup && !user?.id) || !slug || !checklistId || !isOpen) return;
    const token = window.localStorage.getItem(AUTH_TOKEN);
    const controller = new AbortController();
    const url = `${API_BASE}/workspace/${encodeURIComponent(slug)}/checklists/${encodeURIComponent(checklistId)}/personal-state`;
    let alive = true,
      first = true;
    const request = async (method, body) => {
      if (window.localStorage.getItem(AUTH_TOKEN) !== token)
        throw Object.assign(Error(), { code: "UNAUTHORIZED" });
      const res = await fetch(url, {
        method,
        headers: { ...baseHeaders(token), "Content-Type": "application/json" },
        cache: "no-store",
        signal: controller.signal,
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      const result = await res.json();
      if (!res.ok) throw Object.assign(Error(), { code: result.code });
      return result.state;
    };
    const api = { read: () => request("GET"), write: (b) => request("PUT", b) };
    const notify = (next) => {
      if (!alive) return;
      setState(next);
      if (first && next.ready) {
        first = false;
        if (Object.values(next.checks).some(Boolean))
          setLeftover({ updatedAt: next.updatedAt });
      }
    };
    const session = popup
      ? createPopupSession({
          api,
          notify,
          storage: window.localStorage,
          key: popupStorageKey(slug, checklistId),
          owner: token ? String(user?.id || "") : null,
        })
      : createPersonalSession(
          api,
          notify,
          Date.now,
          createLocalNames(
            window.localStorage,
            localNamesKey(user?.id, slug, checklistId)
          )
        );
    sessionRef.current = session;
    void session.load();
    const checkAuth = (event) => {
      if (window.localStorage.getItem(AUTH_TOKEN) !== token ||
          (event?.key === AUTH_TOKEN && event.newValue !== token)) {
        controller.abort();
        popup ? session.detach() : session.dispose();
        setLeftover(null);
      }
    };
    const logout = () => {
      controller.abort();
      popup ? session.detach() : session.dispose();
      setLeftover(null);
    };
    const beforeUnload = (event) => {
      if (session.hasPending()) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    const refresh = () => {
      checkAuth();
      session.expire();
      void session.load();
    };
    const interval = setInterval(refresh, 5000);
    window.addEventListener("storage", checkAuth);
    window.addEventListener("schat-personal-logout", logout);
    window.addEventListener("beforeunload", beforeUnload);
    window.addEventListener("focus", refresh);
    return () => {
      alive = false;
      clearTimeout(timer.current);
      clearInterval(interval);
      if (sessionRef.current === session) sessionRef.current = null;
      window.removeEventListener("focus", refresh);
      // A normal panel close must finish a pending save, unlike logout.
      void session
        .close()
        .then((saved) => {
          if (!saved && window.localStorage.getItem(AUTH_TOKEN) === token)
            window.alert(
              "체크·메모 저장을 완료하지 못했습니다. 다시 열어 확인해 주세요."
            );
        })
        .finally(() => {
          controller.abort();
          window.removeEventListener("storage", checkAuth);
          window.removeEventListener("schat-personal-logout", logout);
          window.removeEventListener("beforeunload", beforeUnload);
        });
    };
  }, [identity, isOpen]);
  const edit = (patch) => {
    sessionRef.current?.edit(patch);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => sessionRef.current?.save(), 800);
  };
  const flush = () => {
    clearTimeout(timer.current);
    sessionRef.current?.mask();
    void sessionRef.current?.save();
  };
  return {
    checkedItems: visible.checks,
    patientInfo: visible.patient,
    otherMemo: visible.other,
    setCheckedItems: (checks) => {
      edit({ checks });
      flush();
    },
    resetCheckedItems: () => {
      edit({ checks: {} });
      flush();
    },
    setMemoField: (field, value) => edit({ [field]: value }),
    flush,
    leftover: Object.values(visible.checks).some(Boolean) ? leftover : null,
    dismissLeftover: () => setLeftover(null),
    disabled: !visible.ready || !!visible.error,
    error: visible.error,
    reload: () => sessionRef.current?.reload(),
    remaining: visible.expiresAt
      ? `${Math.max(1, Math.ceil((visible.expiresAt - Date.now()) / 3600000))}시간 후 삭제`
      : null,
    localOnly: !!visible.localOnly,
    savedChecklist: visible.checklist,
    rememberChecklist: (value) => sessionRef.current?.setChecklist?.(value),
  };
}
