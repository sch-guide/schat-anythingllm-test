const multer = require("multer");
const { reqBody, makeJWT } = require("../utils/http");
const { validatedRequest } = require("../utils/middleware/validatedRequest");
const {
  flexUserRoleValid,
  ROLES,
} = require("../utils/middleware/multiUserProtected");
const { SystemSettings } = require("../models/systemSettings");
const { EventLogs } = require("../models/eventLogs");
const service = require("../utils/schatAccounts/service");
const {
  LOGIN_FAILED_MESSAGE,
  createAttemptLimiter,
  normalizeEmployeeNumber,
} = require("../utils/schatAccounts/core");

// Shared by login and 비밀번호 만들기: 10 failures per IP or employee number
// within 10 minutes block further tries for that key until the window passes.
const attempts = createAttemptLimiter({ max: 10, windowMs: 10 * 60 * 1000 });
const TOO_MANY_MESSAGE = "시도 횟수가 많습니다. 10분 뒤에 다시 시도해 주세요.";
const attemptKeys = (request, employeeNumber) => [
  `ip:${request.ip || "unknown"}`,
  normalizeEmployeeNumber(employeeNumber)
    ? `emp:${normalizeEmployeeNumber(employeeNumber)}`
    : null,
];

// Bulk files are read from memory only and never written to disk.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
});

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
      // Never echo request bodies (they can hold names, numbers, passwords).
      console.error(
        "[schat-accounts]",
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

function schatAccountEndpoints(app) {
  if (!app) return;

  // ---- login (public) --------------------------------------------------------
  app.get(
    "/schat/login-options",
    handle(async (_request, response) => {
      response.status(200).json({
        departments: (await service.listDepartments({ activeOnly: true })).map(
          (d) => d.name
        ),
        legacyLoginAvailable: await service.legacyLoginAvailable(),
      });
    })
  );

  app.post(
    "/schat/employee-login",
    handle(async (request, response) => {
      if (!(await SystemSettings.isMultiUserMode()))
        return response
          .status(400)
          .json({ valid: false, message: LOGIN_FAILED_MESSAGE });
      const { department, employeeNumber, name, password } = reqBody(request);
      const keys = attemptKeys(request, employeeNumber);
      if (attempts.blocked(keys))
        return response
          .status(429)
          .json({ valid: false, token: null, message: TOO_MANY_MESSAGE });
      const { user, firstLoginRequired } = await service.employeeLogin({
        department,
        employeeNumber,
        name,
        password,
      });
      if (firstLoginRequired)
        return response.status(200).json({
          valid: false,
          user: null,
          token: null,
          firstLoginRequired: true,
          message: "처음 로그인입니다. 사용할 비밀번호를 직접 정해 주세요.",
        });
      if (!user) {
        attempts.fail(keys);
        // Record only that a login failed; no typed values are logged.
        await EventLogs.logEvent("failed_login_employee", {
          ip: request.ip || "Unknown IP",
        }).catch(() => null);
        return response.status(200).json({
          valid: false,
          user: null,
          token: null,
          message: LOGIN_FAILED_MESSAGE,
        });
      }
      attempts.reset([keys[1]]);
      await EventLogs.logEvent(
        "login_event",
        { ip: request.ip || "Unknown IP" },
        user.id
      ).catch(() => null);
      const token = makeJWT(
        { id: user.id, username: user.username },
        process.env.JWT_EXPIRY
      );
      response.status(200).json({
        valid: true,
        token,
        user: service.presentUser(user),
        message: null,
      });
    })
  );

  // 비밀번호 만들기, step 1: confirm a registered employee without a password.
  app.post(
    "/schat/first-login/check",
    handle(async (request, response) => {
      const { department, employeeNumber, name } = reqBody(request);
      const keys = attemptKeys(request, employeeNumber);
      if (attempts.blocked(keys))
        return response
          .status(429)
          .json({ ok: false, message: TOO_MANY_MESSAGE });
      const result = await service.firstLoginCheck({
        department,
        employeeNumber,
        name,
      });
      if (!result.ok && !result.alreadySet) attempts.fail(keys);
      response.status(200).json(result);
    })
  );

  // 처음 로그인: department/number/name + a new password chosen by the employee.
  app.post(
    "/schat/first-login",
    handle(async (request, response) => {
      if (!(await SystemSettings.isMultiUserMode()))
        return response
          .status(400)
          .json({ valid: false, message: LOGIN_FAILED_MESSAGE });
      const { department, employeeNumber, name, newPassword, confirmPassword } =
        reqBody(request);
      const keys = attemptKeys(request, employeeNumber);
      if (attempts.blocked(keys))
        return response
          .status(429)
          .json({ valid: false, token: null, message: TOO_MANY_MESSAGE });
      const { user, message } = await service.firstLogin({
        department,
        employeeNumber,
        name,
        newPassword,
        confirmPassword,
      });
      if (!user) {
        attempts.fail(keys);
        await EventLogs.logEvent("failed_first_login", {
          ip: request.ip || "Unknown IP",
        }).catch(() => null);
        return response
          .status(200)
          .json({ valid: false, token: null, message });
      }
      await EventLogs.logEvent(
        "first_login_password_set",
        { ip: request.ip || "Unknown IP" },
        user.id
      ).catch(() => null);
      const token = makeJWT(
        { id: user.id, username: user.username },
        process.env.JWT_EXPIRY
      );
      response.status(200).json({
        valid: true,
        token,
        user: service.presentUser(user),
        message: null,
      });
    })
  );

  // ---- my account --------------------------------------------------------
  app.get(
    "/schat/me",
    signedIn,
    handle(async (_request, response) => {
      const user = await service.getAccount(response.locals.user.id);
      response.status(200).json({ user: service.presentUser(user) });
    })
  );

  app.post(
    "/schat/me/password",
    signedIn,
    handle(async (request, response) => {
      const { currentPassword, newPassword, confirmPassword } =
        reqBody(request);
      if (newPassword !== confirmPassword)
        return response
          .status(400)
          .json({ success: false, error: "새 비밀번호가 서로 다릅니다." });
      const user = await service.changeOwnPassword(response.locals.user.id, {
        currentPassword,
        newPassword,
      });
      await EventLogs.logEvent("user_password_changed", {}, user.id).catch(
        () => null
      );
      response.status(200).json({ success: true, user });
    })
  );

  // ---- my reports & notifications ---------------------------------------
  app.get(
    "/schat/reports/categories",
    signedIn,
    handle(async (_request, response) => {
      response.status(200).json({ categories: service.REPORT_CATEGORIES });
    })
  );

  app.post(
    "/schat/reports",
    signedIn,
    handle(async (request, response) => {
      const report = await service.createReport(
        response.locals.user.id,
        reqBody(request)
      );
      response.status(200).json({ success: true, report });
    })
  );

  app.get(
    "/schat/reports/mine",
    signedIn,
    handle(async (_request, response) => {
      response.status(200).json({
        reports: await service.listMyReports(response.locals.user.id),
      });
    })
  );

  app.get(
    "/schat/faq/suggest",
    signedIn,
    handle(async (request, response) => {
      const q = String(request.query?.q || "").slice(0, 500);
      response.status(200).json({ faqs: await service.suggestFaqs(q) });
    })
  );

  // 이용 가이드 (staff): active FAQ items only.
  app.get(
    "/schat/guide",
    signedIn,
    handle(async (request, response) => {
      const q = String(request.query?.q || "").slice(0, 200);
      const category = String(request.query?.category || "").slice(0, 50);
      response
        .status(200)
        .json({ items: await service.listGuide({ q, category }) });
    })
  );

  app.post(
    "/schat/guide/:id/feedback",
    signedIn,
    handle(async (request, response) => {
      await service.recordGuideFeedback(
        request.params.id,
        reqBody(request).type
      );
      response.status(200).json({ success: true });
    })
  );

  app.get(
    "/schat/notifications",
    signedIn,
    handle(async (_request, response) => {
      response
        .status(200)
        .json(await service.listNotifications(response.locals.user.id));
    })
  );

  app.post(
    "/schat/notifications/read",
    signedIn,
    handle(async (request, response) => {
      const { ids = null } = reqBody(request);
      await service.markNotificationsRead(response.locals.user.id, ids);
      response.status(200).json({ success: true });
    })
  );

  // ---- admin: users & departments ---------------------------------------
  app.get(
    "/schat-admin/accounts",
    adminOnly,
    handle(async (request, response) => {
      response
        .status(200)
        .json({ users: await service.listAccounts(request.query || {}) });
    })
  );

  app.post(
    "/schat-admin/accounts",
    adminOnly,
    handle(async (request, response) => {
      const {
        name,
        employeeNumber,
        departmentId,
        role = "default",
        active = true,
      } = reqBody(request);
      const result = await service.createAccount({
        name,
        employeeNumber,
        departmentId,
        role,
        active,
      });
      await EventLogs.logEvent(
        "user_created",
        {},
        response.locals.user.id
      ).catch(() => null);
      response.status(200).json({ success: true, ...result });
    })
  );

  app.patch(
    "/schat-admin/accounts/:id",
    adminOnly,
    handle(async (request, response) => {
      const allowed = [
        "name",
        "departmentId",
        "role",
        "active",
        "employeeNumber",
      ];
      const body = reqBody(request);
      const changes = Object.fromEntries(
        Object.entries(body).filter(([key]) => allowed.includes(key))
      );
      const user = await service.updateAccount(
        response.locals.user,
        request.params.id,
        changes
      );
      await EventLogs.logEvent(
        "user_updated",
        {},
        response.locals.user.id
      ).catch(() => null);
      response.status(200).json({ success: true, user });
    })
  );

  app.post(
    "/schat-admin/accounts/:id/reset-password",
    adminOnly,
    handle(async (request, response) => {
      const result = await service.resetPassword(
        response.locals.user,
        request.params.id
      );
      await EventLogs.logEvent(
        "user_password_reset",
        {},
        response.locals.user.id
      ).catch(() => null);
      response.status(200).json({ success: true, ...result });
    })
  );

  // 계정 삭제: preview first, then delete only the listed accounts with the
  // typed confirmation. Admin only; self and the last admin are protected.
  app.post(
    "/schat-admin/accounts/delete-preview",
    adminOnly,
    handle(async (request, response) => {
      const { ids = [] } = reqBody(request);
      response.status(200).json({
        success: true,
        ...(await service.deletionPlan(response.locals.user, ids)),
      });
    })
  );

  app.post(
    "/schat-admin/accounts/delete",
    adminOnly,
    handle(async (request, response) => {
      const { ids = [], confirm = "" } = reqBody(request);
      const result = await service.deleteAccounts(
        response.locals.user,
        ids,
        confirm
      );
      response.status(200).json({ success: true, ...result });
    })
  );

  app.post(
    "/schat-admin/accounts/bulk-status",
    adminOnly,
    handle(async (request, response) => {
      const { ids = [], active } = reqBody(request);
      const result = await service.setAccountsActive(
        response.locals.user,
        ids,
        active
      );
      response.status(200).json({ success: true, ...result });
    })
  );

  app.get(
    "/schat-admin/departments",
    adminOnly,
    handle(async (_request, response) => {
      response
        .status(200)
        .json({ departments: await service.listDepartments() });
    })
  );

  app.post(
    "/schat-admin/departments",
    adminOnly,
    handle(async (request, response) => {
      const { name, sortOrder } = reqBody(request);
      const department = await service.saveDepartment({ name, sortOrder });
      response.status(200).json({ success: true, department });
    })
  );

  app.patch(
    "/schat-admin/departments/:id",
    adminOnly,
    handle(async (request, response) => {
      const { name, active, sortOrder } = reqBody(request);
      const department = await service.saveDepartment({
        id: request.params.id,
        name,
        active,
        sortOrder,
      });
      response.status(200).json({ success: true, department });
    })
  );

  // ---- admin: bulk registration ----------------------------------------------
  app.get(
    "/schat-admin/accounts/bulk/template",
    adminOnly,
    handle(async (_request, response) => {
      const buffer = await service.buildTemplate();
      response.setHeader(
        "Content-Type",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      );
      response.setHeader(
        "Content-Disposition",
        `attachment; filename*=UTF-8''${encodeURIComponent("SCHAT_직원_일괄등록_양식.xlsx")}`
      );
      response.status(200).send(Buffer.from(buffer));
    })
  );

  app.post(
    "/schat-admin/accounts/bulk/preview",
    adminOnly,
    (request, response, next) =>
      upload.single("file")(request, response, (error) => {
        if (error)
          return response.status(400).json({
            success: false,
            error:
              error.code === "LIMIT_FILE_SIZE"
                ? "파일은 5MB 이하만 올릴 수 있습니다."
                : "파일을 읽지 못했습니다.",
          });
        next();
      }),
    handle(async (request, response) => {
      if (!request.file)
        return response
          .status(400)
          .json({ success: false, error: "파일을 선택해 주세요." });
      const fileName = Buffer.from(
        request.file.originalname,
        "latin1"
      ).toString("utf8");
      const preview = await service.previewBulk(
        response.locals.user.id,
        request.file.buffer,
        fileName
      );
      request.file.buffer = null; // drop the upload from memory right away
      response.status(200).json({ success: true, ...preview });
    })
  );

  app.post(
    "/schat-admin/accounts/bulk/cancel",
    adminOnly,
    handle(async (request, response) => {
      service.cancelBulk(
        response.locals.user.id,
        String(reqBody(request).token || "")
      );
      response.status(200).json({ success: true });
    })
  );

  app.post(
    "/schat-admin/accounts/bulk/commit",
    adminOnly,
    handle(async (request, response) => {
      const result = await service.commitBulk(
        response.locals.user.id,
        String(reqBody(request).token || "")
      );
      await EventLogs.logEvent(
        "users_bulk_created",
        { count: result.createdCount },
        response.locals.user.id
      ).catch(() => null);
      response.status(200).json({ success: true, ...result });
    })
  );

  // ---- admin: reports, stats, FAQ -----------------------------------------
  app.get(
    "/schat-admin/reports",
    adminOnly,
    handle(async (request, response) => {
      response
        .status(200)
        .json({ reports: await service.listReports(request.query || {}) });
    })
  );

  app.patch(
    "/schat-admin/reports/:id",
    adminOnly,
    handle(async (request, response) => {
      const { status, resolution } = reqBody(request);
      const report = await service.updateReportStatus(
        response.locals.user.id,
        request.params.id,
        {
          status,
          resolution,
        }
      );
      response.status(200).json({ success: true, report });
    })
  );

  app.get(
    "/schat-admin/reports/stats",
    adminOnly,
    handle(async (_request, response) => {
      response.status(200).json(await service.reportStats());
    })
  );

  app.get(
    "/schat-admin/faq",
    adminOnly,
    handle(async (_request, response) => {
      response.status(200).json({ faqs: await service.listFaqs() });
    })
  );

  app.post(
    "/schat-admin/faq",
    adminOnly,
    handle(async (request, response) => {
      const faq = await service.saveFaq(reqBody(request));
      response.status(200).json({ success: true, faq });
    })
  );

  app.patch(
    "/schat-admin/faq/:id",
    adminOnly,
    handle(async (request, response) => {
      const faq = await service.saveFaq({
        ...reqBody(request),
        id: request.params.id,
      });
      response.status(200).json({ success: true, faq });
    })
  );
}

module.exports = { schatAccountEndpoints };
