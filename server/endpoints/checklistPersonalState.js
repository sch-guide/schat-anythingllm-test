function personalStateHandler({ getUser, allowed, store }) {
  return async (request, response) => {
    response.set("Cache-Control", "no-store");
    try {
      const user = await getUser(request, response);
      if (!Number.isSafeInteger(user?.id) || user.id < 1 || user.suspended)
        return response.status(401).json({ code: "UNAUTHORIZED" });
      if (!(await allowed(user, request.params)))
        return response.status(404).json({ code: "UNAVAILABLE" });
      const state =
        request.method === "GET"
          ? await store.read(user.id, request.params.checklistId)
          : await store.save(user.id, request.params.checklistId, request.body);
      return response.status(200).json({ state });
    } catch (error) {
      // Do not log the error or request: SQL/driver errors can echo free text.
      const code = ["CONFLICT", "INVALID_STATE"].includes(error?.code)
        ? error.code
        : "UNAVAILABLE";
      return response
        .status(
          code === "CONFLICT" ? 409 : code === "INVALID_STATE" ? 400 : 503
        )
        .json({ code });
    }
  };
}

function checklistPersonalStateEndpoints(app) {
  const { PrismaClient } = require("@prisma/client");
  const { validatedRequest } = require("../utils/middleware/validatedRequest");
  const { userFromSession, safeJsonParse } = require("../utils/http");
  const { Workspace } = require("../models/workspace");
  const { Document } = require("../models/documents");
  const {
    ChecklistRepository,
  } = require("../utils/documentChecklists/repository");
  const {
    createPersonalStateStore,
  } = require("../utils/checklistPersonalState");
  const privateDb = new PrismaClient({ log: [], errorFormat: "minimal" });
  const store = createPersonalStateStore(privateDb);
  const handler = personalStateHandler({
    getUser: userFromSession,
    store,
    allowed: async (user, { slug, checklistId }) => {
      const workspace = await Workspace.getWithUser(user, { slug });
      if (!workspace) return false;
      const checklist = ChecklistRepository.getById(checklistId);
      if (!checklist || checklist.status !== "active") return false;
      const documents = await Document.forWorkspace(workspace.id);
      // 예전 버전(같은 이름 업데이트로 보관)의 체크리스트는 쓰지 않음.
      return documents.some((doc) => {
        const metadata = safeJsonParse(doc.metadata, {});
        return (
          metadata?.schat_document_update_archived !== true &&
          String(metadata?.document_id || "") === checklist.documentId
        );
      });
    },
  });
  const route = "/workspace/:slug/checklists/:checklistId/personal-state";
  app.get(route, [validatedRequest], handler);
  app.put(route, [validatedRequest], handler);
  // No patient text in cleanup failures; an absent migration must not stop chat.
  const cleanup = () => store.cleanup().catch(() => {});
  void cleanup();
  const timer = setInterval(cleanup, 60000);
  timer.unref();
}
module.exports = { personalStateHandler, checklistPersonalStateEndpoints };
