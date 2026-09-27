// SCHAT 지침서 퀴즈 - AI question generation (admin only).
// The only routes that reach QuizGenerationService, and so the only quiz
// routes that can call Gemini. Staff have no route into this file.
const { reqBody } = require("../utils/http");
const { validatedRequest } = require("../utils/middleware/validatedRequest");
const {
  flexUserRoleValid,
  ROLES,
} = require("../utils/middleware/multiUserProtected");
const { EventLogs } = require("../models/eventLogs");
const bank = require("../utils/schatQuiz/bank");
const generation = require("../utils/schatQuiz/generation");

const adminOnly = [validatedRequest, flexUserRoleValid([ROLES.admin])];
let running = false;

function schatQuizGenerationEndpoints(app) {
  if (!app) return;

  const guarded = (fn) => async (request, response) => {
    if (running)
      return response.status(409).json({
        success: false,
        error: "다른 문제 생성이 진행 중입니다. 잠시 후 다시 시도해 주세요.",
      });
    running = true;
    try {
      await fn(request, response);
    } catch (error) {
      if (error?.userFacing)
        return response
          .status(400)
          .json({ success: false, error: error.message });
      console.error("[schat-quiz-generation]", error?.message);
      response.status(500).json({
        success: false,
        error: "문제를 생성하지 못했습니다. 잠시 후 다시 시도해주세요.",
      });
    } finally {
      running = false;
    }
  };

  // AI로 문제 만들기
  app.post(
    "/schat-admin/quiz/generate",
    adminOnly,
    guarded(async (request, response) => {
      const adminId = response.locals.user?.id ?? null;
      const result = await generation.generate(adminId, reqBody(request));
      await EventLogs.logEvent(
        "schat_quiz_generated",
        { created: result.created, requested: result.requested },
        adminId
      ).catch(() => null);
      response.status(200).json({ success: true, ...result });
    })
  );

  // 다시 생성 (one question)
  app.post(
    "/schat-admin/quiz/questions/:id/regenerate",
    adminOnly,
    guarded(async (request, response) => {
      const question = await generation.regenerate(
        response.locals.user?.id ?? null,
        request.params.id
      );
      response.status(200).json({ success: true, question });
    })
  );

  // 오늘 AI 문제 생성 N회 + this server's generation-service counters.
  app.get("/schat-admin/quiz/usage", adminOnly, async (_request, response) => {
    try {
      response.status(200).json({
        success: true,
        today: await bank.usageToday(),
        service: { ...generation.counters },
        maxPerRequest: generation.MAX_GENERATE,
      });
    } catch (error) {
      console.error("[schat-quiz-generation] usage:", error?.message);
      response.status(500).json({ success: false });
    }
  });
}

module.exports = { schatQuizGenerationEndpoints };
