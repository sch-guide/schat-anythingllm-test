const { answerFeedbackStore } = require("../utils/answerFeedback");
function safeFeedbackHandler(fn) {
  return async (request, response) => {
    response.set("Cache-Control", "no-store");
    try {
      await fn(request, response);
    } catch (error) {
      const code = ["INVALID_FEEDBACK", "NOT_FOUND"].includes(error?.code)
        ? error.code
        : "UNAVAILABLE";
      console.error("[answer-feedback]", code);
      response
        .status(
          code === "INVALID_FEEDBACK" ? 400 : code === "NOT_FOUND" ? 404 : 503
        )
        .json({
          success: false,
          code,
          error:
            code === "INVALID_FEEDBACK"
              ? "이유를 선택하고 메모를 한 줄 200자 이내로 적어 주세요."
              : "평가를 처리하지 못했습니다. 다시 시도해 주세요.",
        });
    }
  };
}
function feedbackSaveHandler({
  getUser,
  getBody,
  getStore = answerFeedbackStore,
}) {
  return safeFeedbackHandler(async (request, response) => {
    const user = await getUser(request, response);
    if (!Number.isSafeInteger(user?.id) || user.id < 1 || user.suspended)
      return response
        .status(401)
        .json({ success: false, code: "UNAUTHORIZED" });
    const feedback = await getStore().save(
      user.id,
      response.locals.workspace.id,
      Number(request.params.chatId),
      getBody(request)
    );
    response.status(200).json({ success: true, feedback });
  });
}
function registerFeedbackAdminEndpoints(
  app,
  { adminOnly, listReports, getStore = answerFeedbackStore }
) {
  app.get(
    "/schat-admin/reports",
    adminOnly,
    safeFeedbackHandler(async (request, response) => {
      const filters = request.query || {};
      const existing = ["wrong", "not_found"].includes(filters.kind)
        ? []
        : await listReports(filters);
      const feedback = await getStore().list(filters);
      const reports = [
        ...existing.map((row) => ({
          ...row,
          kind: "report",
          question: row.title,
        })),
        ...feedback,
      ];
      reports.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
      response.status(200).json({ reports });
    })
  );
  app.get(
    "/schat-admin/answer-feedback/:id",
    adminOnly,
    safeFeedbackHandler(async (request, response) => {
      response
        .status(200)
        .json({ feedback: await getStore().detail(request.params.id) });
    })
  );
  app.patch(
    "/schat-admin/answer-feedback/:id",
    adminOnly,
    safeFeedbackHandler(async (request, response) => {
      response
        .status(200)
        .json({
          success: true,
          feedback: await getStore().resolve(request.params.id),
        });
    })
  );
}
module.exports = {
  feedbackSaveHandler,
  safeFeedbackHandler,
  registerFeedbackAdminEndpoints,
};
