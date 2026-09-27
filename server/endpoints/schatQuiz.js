// SCHAT 지침서 퀴즈 - staff quiz and admin bank endpoints.
// These routes use the question bank only (utils/schatQuiz/bank). They must
// not import the generation service or any AI provider: taking a quiz,
// checking answers, results and wrong-answer notes never call Gemini.
// AI generation lives in endpoints/schatQuizGeneration.js (admin only).
const { reqBody } = require("../utils/http");
const { validatedRequest } = require("../utils/middleware/validatedRequest");
const {
  flexUserRoleValid,
  ROLES,
} = require("../utils/middleware/multiUserProtected");
const bank = require("../utils/schatQuiz/bank");

const adminOnly = [validatedRequest, flexUserRoleValid([ROLES.admin])];
const signedIn = [validatedRequest];

function handle(fn) {
  return async (request, response) => {
    try {
      await fn(request, response);
    } catch (error) {
      if (error?.userFacing)
        return response
          .status(400)
          .json({ success: false, error: error.message });
      console.error(
        "[schat-quiz]",
        request.method,
        request.route?.path,
        error?.message
      );
      response
        .status(500)
        .json({ success: false, error: "요청을 처리하지 못했습니다." });
    }
  };
}

const me = (response) => response.locals.user?.id;

function schatQuizEndpoints(app) {
  if (!app) return;

  // ---- staff (own data only) --------------------------------------------------
  app.get(
    "/schat/quiz/options",
    signedIn,
    handle(async (_request, response) => {
      response
        .status(200)
        .json({ success: true, ...(await bank.staffOptions()) });
    })
  );

  app.post(
    "/schat/quiz/attempts",
    signedIn,
    handle(async (request, response) => {
      const result = await bank.startAttempt(me(response), reqBody(request));
      response.status(200).json({ success: true, ...result });
    })
  );

  app.post(
    "/schat/quiz/wrong-review",
    signedIn,
    handle(async (request, response) => {
      const result = await bank.startWrongReview(
        me(response),
        reqBody(request)
      );
      response.status(200).json({ success: true, ...result });
    })
  );

  app.get(
    "/schat/quiz/attempts/:id",
    signedIn,
    handle(async (request, response) => {
      response.status(200).json({
        success: true,
        attempt: await bank.attemptView(me(response), request.params.id),
      });
    })
  );

  app.post(
    "/schat/quiz/attempts/:id/answers",
    signedIn,
    handle(async (request, response) => {
      const { questionId, choiceId, ox } = reqBody(request);
      const result = await bank.answerQuestion(
        me(response),
        request.params.id,
        questionId,
        { choiceId, ox }
      );
      response.status(200).json({ success: true, ...result });
    })
  );

  app.get(
    "/schat/quiz/history",
    signedIn,
    handle(async (_request, response) => {
      response
        .status(200)
        .json({ success: true, items: await bank.history(me(response)) });
    })
  );

  app.get(
    "/schat/quiz/wrong-notes",
    signedIn,
    handle(async (_request, response) => {
      response
        .status(200)
        .json({ success: true, items: await bank.wrongNotes(me(response)) });
    })
  );

  app.delete(
    "/schat/quiz/wrong-notes/:id",
    signedIn,
    handle(async (request, response) => {
      await bank.removeWrongNote(me(response), request.params.id);
      response.status(200).json({ success: true });
    })
  );

  // ---- admin: bank management (no AI) -------------------------------------------
  app.get(
    "/schat-admin/quiz/documents",
    adminOnly,
    handle(async (_request, response) => {
      response
        .status(200)
        .json({ success: true, documents: await bank.adminDocuments() });
    })
  );

  app.get(
    "/schat-admin/quiz/questions",
    adminOnly,
    handle(async (request, response) => {
      response.status(200).json({
        success: true,
        questions: await bank.adminList(request.query || {}),
      });
    })
  );

  app.get(
    "/schat-admin/quiz/questions/:id",
    adminOnly,
    handle(async (request, response) => {
      response.status(200).json({
        success: true,
        question: await bank.adminQuestion(request.params.id),
      });
    })
  );

  app.patch(
    "/schat-admin/quiz/questions/:id",
    adminOnly,
    handle(async (request, response) => {
      response.status(200).json({
        success: true,
        question: await bank.adminUpdate(
          me(response),
          request.params.id,
          reqBody(request)
        ),
      });
    })
  );

  app.post(
    "/schat-admin/quiz/questions/status",
    adminOnly,
    handle(async (request, response) => {
      const { ids = [], status } = reqBody(request);
      response.status(200).json({
        success: true,
        ...(await bank.setStatus(me(response), ids, status)),
      });
    })
  );

  app.post(
    "/schat-admin/quiz/questions/delete",
    adminOnly,
    handle(async (request, response) => {
      const { ids = [], confirm } = reqBody(request);
      if (confirm !== "삭제")
        return response.status(400).json({
          success: false,
          error: "확인을 위해 '삭제'를 입력해 주세요.",
        });
      response
        .status(200)
        .json({ success: true, ...(await bank.deleteQuestions(ids)) });
    })
  );

  app.get(
    "/schat-admin/quiz/sets",
    adminOnly,
    handle(async (_request, response) => {
      response
        .status(200)
        .json({ success: true, sets: await bank.adminSets() });
    })
  );

  app.patch(
    "/schat-admin/quiz/sets/:id",
    adminOnly,
    handle(async (request, response) => {
      response.status(200).json({
        success: true,
        ...(await bank.updateSet(request.params.id, reqBody(request))),
      });
    })
  );

  app.get(
    "/schat-admin/quiz/stats",
    adminOnly,
    handle(async (_request, response) => {
      response.status(200).json(await bank.adminStats());
    })
  );
}

module.exports = { schatQuizEndpoints };
