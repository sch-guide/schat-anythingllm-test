export function createChunkViewerController(api, workspaceId) {
  let state = {
    documents: null,
    chunks: null,
    chats: null,
    detail: null,
    selectedDocument: "",
    q: "",
    documentOffset: 0,
    chatOffset: 0,
    chunkOffset: 0,
    chunkHistory: [],
    selectedChat: null,
    loading: {},
    errors: {},
  };
  let alive = true;
  let serial = 0;
  const pending = {};
  const listeners = new Set();
  function update(values) {
    state = { ...state, ...values };
    listeners.forEach((fn) => fn());
  }
  async function read(key, action) {
    const token = ++serial;
    pending[key] = token;
    update({
      [key]: null,
      loading: { ...state.loading, [key]: true },
      errors: { ...state.errors, [key]: "" },
    });
    try {
      const result = await action();
      if (!alive || pending[key] !== token) return null;
      update({ [key]: result });
      return result;
    } catch (error) {
      if (alive && pending[key] === token)
        update({
          errors: {
            ...state.errors,
            [key]: error?.message || "조회하지 못했습니다.",
          },
        });
      return null;
    } finally {
      if (alive && pending[key] === token)
        update({ loading: { ...state.loading, [key]: false } });
    }
  }
  const controller = {
    getSnapshot: () => state,
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    async start({ documents = true } = {}) {
      alive = true;
      if (!workspaceId) return;
      await Promise.all([
        documents ? controller.documentPage(0) : null,
        controller.chatPage(0),
      ]);
    },
    stop() {
      alive = false;
      for (const key of Object.keys(pending)) pending[key] = ++serial;
    },
    async documentPage(offset) {
      update({
        documentOffset: offset,
        selectedDocument: "",
        chunks: null,
        chunkHistory: [],
      });
      pending.chunks = ++serial;
      const data = await read("documents", () =>
        api.documents(workspaceId, offset)
      );
      if (data?.items?.length)
        await controller.selectDocument(data.items[0].documentId);
    },
    async selectDocument(documentId) {
      update({ selectedDocument: documentId, q: "", chunkHistory: [] });
      return controller.chunkPage(0);
    },
    async search(q) {
      update({ q, chunkHistory: [] });
      return controller.chunkPage(0);
    },
    async chunkPage(offset) {
      update({ chunkOffset: offset });
      const query = { documentId: state.selectedDocument, q: state.q, offset };
      if (!query.documentId) return;
      return read("chunks", () => api.chunks(workspaceId, query));
    },
    nextChunks() {
      if (!state.chunks?.hasMore || state.loading.chunks) return;
      const next = state.chunks.nextOffset;
      update({ chunkHistory: [...state.chunkHistory, state.chunkOffset] });
      return controller.chunkPage(next);
    },
    previousChunks() {
      if (!state.chunkHistory.length || state.loading.chunks) return;
      const previous = state.chunkHistory.at(-1);
      update({ chunkHistory: state.chunkHistory.slice(0, -1) });
      return controller.chunkPage(previous);
    },
    chatPage(offset) {
      pending.detail = ++serial;
      update({
        chatOffset: offset,
        detail: null,
        selectedChat: null,
        loading: { ...state.loading, detail: false },
        errors: { ...state.errors, detail: "" },
      });
      return read("chats", () => api.chats(workspaceId, offset));
    },
    openChat(id) {
      update({ selectedChat: id });
      return read("detail", () => api.chat(workspaceId, id));
    },
  };
  return controller;
}
