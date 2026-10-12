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
export function createPersonalSession(api, notify, clock = Date.now) {
  let state = { ...empty(), ready: false, saving: false, error: null };
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
          ...(result && result.expiresAt > clock() ? result : empty()),
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
      publish();
    },
    mask() {
      if (disposed) return;
      state.patient = maskChecklistPatient(state.patient);
      state.other = maskChecklistOther(state.other);
      publish();
    },
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
            session.mask();
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
                : result),
              saving: false,
            };
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
