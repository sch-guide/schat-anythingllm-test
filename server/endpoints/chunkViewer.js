const { Workspace } = require("../models/workspace");
const { validatedRequest } = require("../utils/middleware/validatedRequest");
const {
  flexUserRoleValid,
  ROLES,
} = require("../utils/middleware/multiUserProtected");
const { createChunkViewer } = require("../utils/schatAdmin/chunkViewer");

function chunkViewerEndpoints(app) {
  const viewer = createChunkViewer();
  const guards = [
    (_req, res, next) => {
      res.set("Cache-Control", "no-store");
      next();
    },
    validatedRequest,
    flexUserRoleValid([ROLES.admin]),
  ];
  const handlers = [
    ["/schat-admin/chunk-documents", "documents"],
    ["/schat-admin/chunks", "chunks"],
    ["/schat-admin/chunk-chats", "chats"],
    ["/schat-admin/chunk-chats/:id", "chat"],
  ];
  for (const [route, method] of handlers) {
    app.get(route, guards, async (req, res) => {
      try {
        const raw = req.query.workspaceId;
        const id =
          typeof raw === "string" && /^[1-9]\d*$/.test(raw) ? Number(raw) : NaN;
        if (!Number.isSafeInteger(id))
          return res
            .status(400)
            .json({ error: "관리할 작업 공간을 선택해 주세요." });
        const workspace = res.locals.multiUserMode
          ? await Workspace.getWithUser(res.locals.user, { id })
          : await Workspace.get({ id });
        if (!workspace)
          return res
            .status(404)
            .json({ error: "작업 공간을 찾을 수 없습니다." });
        res.json(
          await viewer[method](
            workspace,
            method === "chat" ? req.params.id : req.query
          )
        );
      } catch (error) {
        const known = [400, 404, 409, 422].includes(error?.status);
        res.status(known ? error.status : 503).json({
          error: known
            ? error.message
            : "검색 조각 조회에 실패했습니다. 잠시 뒤 다시 시도해 주세요.",
        });
      }
    });
  }
}
module.exports = { chunkViewerEndpoints };
