import {
  maskChecklistOther,
  maskChecklistPatient,
} from "./checklistPatientMask.js";
const empty = () => ({
  checks: {},
  patient: "",
  other: "",
  revision: null,
  updatedAt: null,
  expiresAt: null,
});
export function clearLegacyChecklistCopies(storage) {
  try {
    const keys = Array.from({ length: storage.length }, (_, i) =>
      storage.key(i)
    );
    for (const key of keys)
      if (/^schat_checklist_(memo|checks):/.test(key)) storage.removeItem(key);
  } catch {
    /* No browser persistence is used by the new feature. */
  }
}
const DAY = 86400000;
// 2026-10-17 사용자 결정: 서버에는 지금처럼 이름 가운데 글자를 가려(홍○동) 저장하고,
// 이 PC 화면(입력 중·새로고침·로그아웃 후 별도 창)에서는 적은 그대로(홍길동) 보여 준다.
// localNames: 이 PC에 둔 원래 글자 {read, write, clear}. 서버 값이 그 글자를 가린 값과
// 같을 때만 원래 글자로 바꿔 보여 준다(다른 PC에서 고친 내용이면 서버 값 그대로).
// 채팅 화면 체크리스트 창의 "이 PC 원래 글자" 보관(사용자·작업 공간·체크리스트별, 24시간).
export const localNamesKey = (userId, slug, checklistId) =>
  `schat_checklist_names_v1:${encodeURIComponent(String(userId))}:${encodeURIComponent(slug)}:${encodeURIComponent(checklistId)}`;
export function createLocalNames(storage, key, clock = Date.now) {
  return {
    read() {
      try {
        return JSON.parse(storage.getItem(key));
      } catch {
        return null;
      }
    },
    write(value) {
      try {
        storage.setItem(key, JSON.stringify(value));
      } catch {}
    },
    clear() {
      try {
        storage.removeItem(key);
      } catch {}
    },
  };
}
/** 기한(24시간)이 지난 이 PC 원래 글자를 지운다. */
export function clearExpiredLocalNames(storage, clock = Date.now) {
  try {
    const keys = Array.from({ length: storage.length }, (_, i) => storage.key(i));
    for (const key of keys) {
      if (!/^schat_checklist_names_v1:/.test(key || "")) continue;
      let saved = null;
      try {
        saved = JSON.parse(storage.getItem(key));
      } catch {}
      if (!(saved?.expiresAt > clock())) storage.removeItem(key);
    }
  } catch {}
}
export function createPersonalSession(
  api,
  notify,
  clock = Date.now,
  localNames = null
) {
  let state = { ...empty(), ready: false, saving: false, error: null };
  const withLocalNames = (server) => {
    let saved = null;
    try {
      saved = localNames?.read?.();
    } catch {}
    if (!saved || !(saved.expiresAt > clock())) return server;
    const patient = String(saved.patient || "");
    const other = String(saved.other || "");
    return {
      ...server,
      patient:
        maskChecklistPatient(patient) === String(server.patient || "")
          ? patient
          : server.patient,
      other:
        maskChecklistOther(other) === String(server.other || "")
          ? other
          : server.other,
    };
  };
  const rememberNames = () => {
    try {
      localNames?.write?.({
        patient: state.patient,
        other: state.other,
        expiresAt: state.expiresAt || clock() + DAY,
      });
    } catch {}
  };
  let disposed = false,
    dirty = false,
    busy = false,
    loading = false,
    changes = 0,
    flight = null;
  const publish = () => notify({ ...state, checks: { ...state.checks } });
  const fault = (e) =>
    ["CONFLICT", "UNAUTHORIZED"].includes(e?.code) ? e.code : "UNAVAILABLE";
  const session = {
    async load() {
      if (disposed || busy || dirty || loading) return;
      loading = true;
      const startedAtChange = changes;
      try {
        const result = await api.read();
        if (disposed || dirty || startedAtChange !== changes) return;
        state = {
          ...withLocalNames(
            result && result.expiresAt > clock() ? result : empty()
          ),
          ready: true,
          saving: false,
          error: null,
        };
        publish();
      } catch (e) {
        if (!disposed) {
          state.error = fault(e);
          state.ready = false;
          publish();
        }
      } finally {
        loading = false;
      }
    },
    edit(patch) {
      if (disposed || !state.ready || state.error) return;
      state = { ...state, ...patch };
      dirty = true;
      changes++;
      if ("patient" in patch || "other" in patch) rememberNames();
      publish();
    },
    // 화면 글자는 가리지 않는다(서버로 보낼 때만 가림). 예전 호출과 맞추려고 남겨 둠.
    mask() {},
    save() {
      if (busy) return flight;
      if (disposed || !dirty || !state.ready || state.error)
        return Promise.resolve();
      if (state.expiresAt && state.expiresAt <= clock()) {
        session.expire();
        return;
      }
      busy = true;
      flight = (async () => {
        try {
          while (dirty && !disposed && !state.error) {
            const generation = changes;
            const payload = {
              revision: state.revision,
              checks: { ...state.checks },
              patient: maskChecklistPatient(state.patient),
              other: maskChecklistOther(state.other),
            };
            state.saving = true;
            publish();
            const result = await api.write(payload);
            if (disposed || state.error === "EXPIRED") return;
            dirty = generation !== changes;
            state = {
              ...state,
              ...(dirty
                ? {
                    revision: result.revision,
                    updatedAt: result.updatedAt,
                    expiresAt: result.expiresAt,
                  }
                : { ...result, patient: state.patient, other: state.other }),
              saving: false,
            };
            rememberNames();
            publish();
          }
        } catch (e) {
          if (!disposed) {
            state.error = fault(e);
            state.saving = false;
            publish();
          }
        } finally {
          busy = false;
        }
      })();
      return flight;
    },
    expire() {
      if (disposed || !state.expiresAt || state.expiresAt > clock()) return;
      // Keep the old revision so an in-flight edit cannot revive expired notes.
      state = { ...empty(), ready: false, saving: false, error: "EXPIRED" };
      try {
        localNames?.clear?.();
      } catch {}
      dirty = false;
      changes++;
      publish();
    },
    async reload() {
      if (disposed || busy) return;
      dirty = false;
      state.error = null;
      await session.load();
    },
    async close() {
      await session.save();
      const saved = !dirty && !state.error;
      session.dispose();
      return saved;
    },
    hasPending() {
      return dirty || busy;
    },
    dispose() {
      disposed = true;
      dirty = false;
      state = { ...empty(), ready: false, saving: false, error: null };
      publish();
    },
  };
  return session;
}
