// One controller belongs to one mounted workspace view. Session/request numbers
// discard responses after unmount, StrictMode restart or a newer read.
export function createAnswerCacheController(api, workspaceId) {
  let state = { data: null, loading: true, busy: false, error: "", notice: "" };
  let active = false,
    session = 0,
    request = 0;
  const listeners = new Set();
  function update(patch) {
    state = { ...state, ...patch };
    listeners.forEach((listener) => listener());
  }
  async function refresh() {
    const currentSession = session,
      currentRequest = ++request;
    update({ loading: true, data: null, error: "" });
    const current = () =>
      active && session === currentSession && request === currentRequest;
    try {
      const data = await api.list(workspaceId);
      if (current()) update({ data, loading: false });
    } catch (error) {
      if (current())
        update({
          data: null,
          loading: false,
          error: error.message || "현황을 불러오지 못했습니다.",
        });
    }
  }
  async function mutate(action, notice) {
    if (!active || state.busy || state.loading) return false;
    const currentSession = session;
    update({ busy: true, error: "", notice: "" });
    try {
      await action();
      if (!active || session !== currentSession) return false;
      update({ notice });
      await refresh();
      return true;
    } catch (error) {
      if (active && session === currentSession)
        update({ error: error.message || "저장본을 삭제하지 못했습니다." });
      return false;
    } finally {
      if (active && session === currentSession) update({ busy: false });
    }
  }
  return {
    getSnapshot: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    start() {
      active = true;
      session++;
      update({ busy: false, notice: "" });
      return refresh();
    },
    stop() {
      active = false;
      session++;
      request++;
    },
    load() {
      return active && !state.busy ? refresh() : Promise.resolve(false);
    },
    remove(id) {
      return mutate(
        () => api.remove(workspaceId, id),
        "답변 저장본을 삭제했습니다.",
      );
    },
    clear(confirmed) {
      return confirmed === true
        ? mutate(
            () => api.clear(),
            "모든 작업 공간의 답변 저장본을 비웠습니다.",
          )
        : Promise.resolve(false);
    },
  };
}
