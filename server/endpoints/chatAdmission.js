const { validatedRequest } = require("../utils/middleware/validatedRequest");
const {
  flexUserRoleValid,
  ROLES,
} = require("../utils/middleware/multiUserProtected");
const { runtime } = require("../utils/chatAdmissionRuntime");
const { dailyUsage } = require("../utils/geminiDailyUsage");
async function dailySnapshot() {
  return dailyUsage.snapshot(process.env.GEMINI_LLM_MODEL_PREF || "gemini-2.0-flash-lite");
}
function chatAdmissionEndpoints(app) {
  const guards = [validatedRequest, flexUserRoleValid([ROLES.admin])];
  app.get("/schat-admin/chat-admission", guards, async (_req, res) => {
    res.set("Cache-Control", "no-store");
    try {
      res.json({...(await runtime.ready()).snapshot(), dailyUsage: await dailySnapshot()});
    } catch {
      res.status(503).json({ error: "답변 대기 현황을 불러오지 못했습니다." });
    }
  });
  app.put("/schat-admin/chat-admission", guards, async (req, res) => {
    res.set("Cache-Control", "no-store");
    try {
      res.json({...await runtime.save(req.body?.maxActive), dailyUsage: await dailySnapshot()});
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
