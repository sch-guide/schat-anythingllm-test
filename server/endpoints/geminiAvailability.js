const { validatedRequest } = require("../utils/middleware/validatedRequest");
const {
  flexUserRoleValid,
  ROLES,
} = require("../utils/middleware/multiUserProtected");
const { monitor } = require("../utils/geminiAvailability");
const { loadFees, rechargeStore } = require("../utils/aiRecharges");
const { saveBudget, validateConfig } = require("../utils/geminiBudget");

function geminiAvailabilityEndpoints(app) {
  app.get(
    "/schat-admin/gemini-availability",
    [validatedRequest, flexUserRoleValid([ROLES.admin])],
    async (_request, response) => {
      response.set("Cache-Control", "no-store");
      const state = await monitor.getState();
      let budget;
      try {
        budget = await loadFees();
      } catch {
        budget = {
          percent: null,
          estimatedKrw: null,
          level: "unavailable",
          reason: "사용량 또는 설정을 불러오지 못하여 계산할 수 없습니다.",
        };
      }
      response.status(200).json({ alerts: monitor.snapshot(), state, budget });
    }
  );
  for (const [method, route, action] of [
    ["post", "/schat-admin/ai-recharges", "create"],
    ["put", "/schat-admin/ai-recharges/:id", "update"],
    ["delete", "/schat-admin/ai-recharges/:id", "delete"],
  ])
    app[method](
      route,
      [validatedRequest, flexUserRoleValid([ROLES.admin])],
      async (request, response) => {
        response.set("Cache-Control", "no-store");
        try {
          const saved = await rechargeStore().mutate(
            {
              ...request.body,
              ...(action !== "create" ? { id: request.params.id } : {}),
            },
            action
          );
          response.status(200).json(saved);
        } catch (error) {
          const safe = [400, 404, 409].includes(error.status);
          response
            .status(safe ? error.status : 503)
            .json({
              error: safe
                ? error.message
                : "충전 기록을 저장하지 못했어요. 잠시 후 다시 시도해 주세요.",
            });
        }
      }
    );
  app.put(
    "/schat-admin/gemini-budget",
    [validatedRequest, flexUserRoleValid([ROLES.admin])],
    async (request, response) => {
      response.set("Cache-Control", "no-store");
      let config;
      try {
        config = validateConfig(request.body);
      } catch {
        return response.status(400).json({
          error:
            "월 예산과 모델별 예상 단가를 양수로 입력해 주세요. 모델 이름은 중복될 수 없습니다.",
        });
      }
      try {
        await saveBudget(config);
        response.status(200).json({ success: true });
      } catch {
        response.status(503).json({
          error: "설정을 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.",
        });
      }
    }
  );
}
module.exports = { geminiAvailabilityEndpoints };
