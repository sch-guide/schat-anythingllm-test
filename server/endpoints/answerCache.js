const { Workspace } = require("../models/workspace");
const { validatedRequest } = require("../utils/middleware/validatedRequest");
const {
  flexUserRoleValid,
  ROLES,
} = require("../utils/middleware/multiUserProtected");
const { cache } = require("../utils/answerCacheRuntime");

function answerCacheEndpoints(app) {
  const guards = [
    (_req, res, next) => {
      res.set("Cache-Control", "no-store");
      next();
    },
    validatedRequest,
    flexUserRoleValid([ROLES.admin]),
  ];
  async function workspaceScope(req, res) {
    const raw = req.query.workspaceId;
    const id =
      typeof raw === "string" && /^[1-9]\d*$/.test(raw) ? Number(raw) : NaN;
    if (!Number.isSafeInteger(id)) {
      res.status(400).json({ error: "관리할 작업 공간을 선택해 주세요." });
      return null;
    }
    const workspace = res.locals.multiUserMode
      ? await Workspace.getWithUser(res.locals.user, { id })
      : await Workspace.get({ id });
    if (!workspace) {
      res.status(404).json({ error: "작업 공간을 찾을 수 없습니다." });
      return null;
    }
    return workspace.id;
  }
  app.get("/schat-admin/answer-cache", guards, async (req, res) => {
    try {
      const workspaceId = await workspaceScope(req, res);
      if (workspaceId == null) return;
      const stats = cache.stats();
      res.json({
        entries: cache.list(workspaceId),
        stats: {
          entries: stats.entries,
          savedAnswerCalls: stats.hits,
          scope: "all-workspaces-since-start",
          maxEntries: 100,
        },
      });
    } catch {
      res
        .status(503)
        .json({ error: "답변 재사용 현황을 불러오지 못했습니다." });
    }
  });
  app.delete("/schat-admin/answer-cache/:id", guards, async (req, res) => {
    try {
      const workspaceId = await workspaceScope(req, res);
      if (workspaceId == null) return;
      // Scope the lookup before removal: a foreign entry ID must never be enough.
      if (
        !cache.list(workspaceId).some((entry) => entry.id === req.params.id) ||
        !cache.remove(req.params.id)
      )
        return res
          .status(404)
          .json({ error: "이 작업 공간에서 해당 저장본을 찾을 수 없습니다." });
      res.json({ ok: true });
    } catch {
      res.status(503).json({ error: "답변 저장본을 삭제하지 못했습니다." });
    }
  });
  app.post("/schat-admin/answer-cache/clear", guards, (req, res) => {
    if (req.body?.confirm !== true)
      return res
        .status(400)
        .json({
          error: "모든 작업 공간의 답변 저장본 비우기를 확인해 주세요.",
        });
    cache.clear();
    res.json({ ok: true });
  });
}
module.exports = { answerCacheEndpoints };
