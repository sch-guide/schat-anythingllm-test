const { SystemSettings } = require("../../models/systemSettings");
const { User } = require("../../models/user");
const { EncryptionManager } = require("../EncryptionManager");
const { decodeJWT } = require("../http");
const { UserMetaCache } = require("../userLocale");
const EncryptionMgr = new EncryptionManager();

async function validatedRequest(request, response, next) {
  const multiUserMode = await SystemSettings.isMultiUserMode();
  response.locals.multiUserMode = multiUserMode;
  if (multiUserMode)
    return await validateMultiUserRequest(request, response, next);

  // When in development passthrough auth token for ease of development.
  // Or if the user simply did not set an Auth token or JWT Secret
  if (
    process.env.NODE_ENV === "development" ||
    !process.env.AUTH_TOKEN ||
    !process.env.JWT_SECRET
  ) {
    UserMetaCache.setFromRequest(request);
    next();
    return;
  }

  if (!process.env.AUTH_TOKEN) {
    response.status(401).json({
      error: "You need to set an AUTH_TOKEN environment variable.",
    });
    return;
  }

  const auth = request.header("Authorization");
  const token = auth ? auth.split(" ")[1] : null;

  if (!token) {
    response.status(401).json({
      error: "No auth token found.",
    });
    return;
  }

  const bcrypt = require("bcryptjs");
  const { p } = decodeJWT(token);

  if (p === null || !/\w{32}:\w{32}/.test(p)) {
    response.status(401).json({
      error: "Token expired or failed validation.",
    });
    return;
  }

  // Since the blame of this comment we have been encrypting the `p` property of JWTs with the persistent
  // encryptionManager PEM's. This prevents us from storing the `p` unencrypted in the JWT itself, which could
  // be unsafe. As a consequence, existing JWTs with invalid `p` values that do not match the regex
  // in ln:44 will be marked invalid so they can be logged out and forced to log back in and obtain an encrypted token.
  // This kind of methodology only applies to single-user password mode.
  if (
    !bcrypt.compareSync(
      EncryptionMgr.decrypt(p),
      bcrypt.hashSync(process.env.AUTH_TOKEN, 10)
    )
  ) {
    response.status(401).json({
      error: "Invalid auth credentials.",
    });
    return;
  }

  UserMetaCache.setFromRequest(request);
  next();
}

async function validateMultiUserRequest(request, response, next) {
  const auth = request.header("Authorization");
  const token = auth ? auth.split(" ")[1] : null;

  if (!token) {
    response.status(401).json({
      error: "No auth token found.",
    });
    return;
  }

  const valid = decodeJWT(token);
  if (!valid || !valid.id) {
    response.status(401).json({
      error: "Invalid auth token.",
    });
    return;
  }

  const user = await User.get({ id: valid.id });
  if (!user) {
    response.status(401).json({
      error: "Invalid auth for user.",
    });
    return;
  }

  if (user.suspended) {
    response.status(401).json({
      error: "User is suspended from system",
    });
    return;
  }

  // SCHAT: an account without a password (new, or reset by an admin) has no
  // usable session; the employee must go through 처음 로그인 again.
  if (user.must_change_password) {
    response.status(401).json({
      error: "password_setup_required",
      message: "처음 로그인에서 비밀번호를 먼저 정해 주세요.",
    });
    return;
  }

  // SCHAT: 개인정보 수집·이용 동의 전에는 동의 화면과 로그인 확인 외의
  // 기능을 쓰지 못한다(직원·관리자 모두). 버튼이 아니라 서버에서 막는다.
  const consent = require("../privacyConsent");
  if (!consent.exemptPath(request.path)) {
    let agreed = false;
    try {
      agreed = await consent.hasCurrentConsent(user.id);
    } catch {
      response.status(503).json({
        error: "privacy_consent_unavailable",
        message: "동의 상태를 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.",
      });
      return;
    }
    if (!agreed) {
      response.status(403).json({
        error: "privacy_consent_required",
        consentRequired: true,
        message: "개인정보 수집·이용에 동의한 뒤 SCHAT을 이용할 수 있습니다.",
      });
      return;
    }
  }

  response.locals.user = user;
  UserMetaCache.setFromRequest(request, user.id);
  next();
}

module.exports = {
  validatedRequest,
};
