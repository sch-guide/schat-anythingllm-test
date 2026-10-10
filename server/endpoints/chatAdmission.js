const { validatedRequest } = require("../utils/middleware/validatedRequest");
const {
  flexUserRoleValid,
  ROLES,
} = require("../utils/middleware/multiUserProtected");
const { runtime } = require("../utils/chatAdmissionRuntime");
function chatAdmissionEndpoints(app) {
  const guards = [validatedRequest, flexUserRoleValid([ROLES.admin])];
  app.get("/schat-admin/chat-admission", guards, async (_req, res) => {
    res.set("Cache-Control", "no-store");
    try {
      res.json((await runtime.ready()).snapshot());
    } catch {
      res.status(503).json({ error: "답변 대기 현황을 불러오지 못했습니다." });
    }
  });
  app.put("/schat-admin/chat-admission", guards, async (req, res) => {
    res.set("Cache-Control", "no-store");
    try {
      res.json(await runtime.save(req.body?.maxActive));
    } catch (error) {
      res.status(error?.code === "SCHAT_INVALID_LIMIT" ? 400 : 503).json({
        error:
          error?.code === "SCHAT_INVALID_LIMIT"
            ? "동시 답변 수는 1~16의 정수로 입력해 주세요."
            : "설정을 저장하지 못했습니다.",
      });
    }
  });
}
module.exports = { chatAdmissionEndpoints };
