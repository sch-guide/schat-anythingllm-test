import { createPersonalSession } from "./checklistPersonalSession.js";
import {
  maskChecklistOther,
  maskChecklistPatient,
} from "./checklistPatientMask.js";

const DAY = 86400000;
const blank = () => ({
  checks: {},
  patient: "",
  other: "",
  updatedAt: null,
  expiresAt: null,
  ready: true,
  error: null,
});
export const popupStorageKey = (slug, id) =>
  `schat_popup_v1:${encodeURIComponent(slug)}:${encodeURIComponent(id)}`;
export function readPopupSnapshot(storage, key, owner, now = Date.now()) {
  try {
    const saved = JSON.parse(storage.getItem(key));
    if (!saved) return null;
    const localOnly = !!saved.localOnly || saved.owner !== owner || !owner;
    return {
      ...(saved.expiresAt > now ? saved : blank()),
      checklist: saved.checklist,
      localOnly,
      ready: localOnly,
    };
  } catch {
    return null;
  }
}
export function hasSavedPopup(pathname, storage) {
  const match = /^\/workspace\/([^/]+)\/checklist\/([^/]+)\/?$/.exec(pathname);
  if (!match) return false;
  try {
    return !!readPopupSnapshot(
      storage,
      popupStorageKey(
        decodeURIComponent(match[1]),
        decodeURIComponent(match[2])
      ),
      null
    )?.checklist;
  } catch {
    return false;
  }
}

// Only standalone windows use this store. It contains no authentication token.
// 2026-10-17 사용자 결정: 이 PC 저장본에는 적은 그대로(홍길동) 두고, 서버에는 가린 이름만 보낸다
// (가리기는 createPersonalSession이 서버로 보낼 때 한다).
export function createPopupSession({
  api,
  notify,
  storage,
  key,
  owner,
  clock = Date.now,
  // 채팅 화면 체크리스트 창이 이 PC에 둔 원래 글자(같은 사용자·체크리스트). 별도 창으로 열어도
  // 홍길동 그대로 보이게 하고, 별도 창에서 고친 글자도 채팅 화면 창과 함께 쓴다.
  sharedNames = null,
}) {
  let cached = null;
  try {
    cached = JSON.parse(storage.getItem(key));
  } catch {}
  let localOnly =
    !!cached?.localOnly || (!!cached && cached.owner !== owner) || !owner;
  let state = cached?.expiresAt > clock() ? cached : blank();
  let checklist = cached?.checklist || null;
  let closed = false;
  let editedAt = 0;
  const publish = () => {
    if (!closed)
      notify({ ...state, checks: { ...state.checks }, localOnly, checklist });
  };
  const persist = () => {
    try {
      storage.setItem(
        key,
        JSON.stringify({
          checks: state.checks,
          patient: state.patient,
          other: state.other,
          updatedAt: state.updatedAt,
          expiresAt: state.expiresAt,
          checklist,
          localOnly,
          owner: localOnly ? null : owner,
        })
      );
      return true;
    } catch {
      state.error = "UNAVAILABLE";
      publish();
      return false;
    }
  };
  const server = createPersonalSession(
    api,
    (next) => {
      if (closed || localOnly) return;
      state =
        next.error && next.error !== "EXPIRED" && !next.ready
          ? { ...state, ready: false, saving: false, error: next.error }
          : { ...next };
      if (next.error === "EXPIRED") editedAt = 0;
      if (editedAt > (next.updatedAt || 0)) {
        state.updatedAt = editedAt;
        state.expiresAt = editedAt + DAY;
      }
      if (next.ready || next.error === "EXPIRED") persist();
      publish();
    },
    clock,
    {
      // 새로고침 뒤 서버의 가린 이름 대신 이 PC 저장본의 원래 글자를 보여 준다.
      read: () => {
        const own = cached
          ? {
              patient: cached.patient,
              other: cached.other,
              expiresAt: cached.expiresAt,
            }
          : null;
        let shared = null;
        try {
          shared = sharedNames?.read?.() || null;
        } catch {}
        // 둘 다 있으면 더 최근에 고친 쪽(기한이 더 늦은 쪽)을 쓴다.
        return (shared?.expiresAt || 0) > (own?.expiresAt || 0) ? shared : own;
      },
      write: (value) => sharedNames?.write?.(value),
      clear: () => sharedNames?.clear?.(),
    }
  );
  const result = {
    setChecklist(value) {
      if (value && !localOnly && !closed) {
        checklist = value;
        persist();
        publish();
      }
    },
    async load() {
      if (localOnly) {
        result.expire();
        publish();
      } else await server.load();
    },
    detach() {
      if (closed || localOnly) return;
      localOnly = true; // Ignore dispose and every late HTTP response before clearing the server session.
      server.dispose();
      // 로그아웃 뒤 이 PC에 남는 별도 창에도 가린 이름만 남긴다(2026-10-27, 예전 방식).
      state = {
        ...state,
        patient: maskChecklistPatient(state.patient),
        other: maskChecklistOther(state.other),
        ready: true,
        saving: false,
        error: null,
      };
      result.expire();
      persist();
      publish();
    },
    edit(patch) {
      if (closed) return;
      if (!localOnly) {
        if (!state.ready || state.error) return;
        if (
          Object.entries(patch).every(
            ([k, v]) => JSON.stringify(v) === JSON.stringify(state[k])
          )
        )
          return;
        editedAt = clock();
        server.edit(patch);
        // A pending edit is retained even if logout aborts the debounced HTTP save.
        persist();
        return;
      }
      result.expire();
      const next = { ...state, ...patch };
      if (
        JSON.stringify([next.checks, next.patient, next.other]) ===
        JSON.stringify([state.checks, state.patient, state.other])
      )
        return;
      state = {
        ...next,
        updatedAt: clock(),
        expiresAt: clock() + DAY,
        error: null,
      };
      persist();
      publish();
    },
    // 엔터·칸 벗어남 때 별도 창 화면·PC 저장본의 글자도 가린다(2026-10-27, 예전 방식으로 되돌림).
    mask() {
      if (localOnly) {
        state.patient = maskChecklistPatient(state.patient);
        state.other = maskChecklistOther(state.other);
        persist();
        publish();
      } else server.mask();
    },
    save() {
      if (localOnly) {
        result.mask();
        return Promise.resolve();
      }
      return server.save();
    },
    expire() {
      if (!localOnly) return server.expire();
      if (state.expiresAt && state.expiresAt <= clock()) {
        state = blank();
        persist();
        publish(); // Retain only the detached-mode marker and checklist template.
      }
    },
    reload() {
      if (localOnly) return result.load();
      editedAt = 0;
      return server.reload();
    },
    hasPending() {
      return localOnly ? false : server.hasPending();
    },
    async close() {
      if (localOnly) {
        result.mask();
        closed = true;
        return !state.error;
      }
      const saved = await server.close();
      closed = true;
      return saved;
    },
    dispose() {
      closed = true;
      server.dispose();
    },
  };
  if (cached && !(cached.expiresAt > clock())) persist();
  return result;
}
