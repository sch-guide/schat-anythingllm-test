const { reqBody } = require("../http");

// Only trust mode and user loaded by validatedRequest, never request fields.
function requireAnswerManagement(_request, response, next) {
  if (
    response.locals.multiUserMode === false ||
    response.locals.user?.role === "admin"
  )
    return next();
  return response
    .status(403)
    .json({ error: "답변 수정·삭제·분기는 관리자만 사용할 수 있습니다." });
}

function requireChatEditPermission(request, response, next) {
  if (reqBody(request)?.role === "user") return next();
  return requireAnswerManagement(request, response, next);
}

module.exports = { requireAnswerManagement, requireChatEditPermission };
