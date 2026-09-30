const crypto = require("node:crypto");
const { Workspace } = require("../models/workspace");
const { Document } = require("../models/documents");
const { EventLogs } = require("../models/eventLogs");
const { getVectorDbClass } = require("../utils/helpers");
const { reqBody } = require("../utils/http");
const {
  flexUserRoleValid,
  ROLES,
} = require("../utils/middleware/multiUserProtected");
const { validatedRequest } = require("../utils/middleware/validatedRequest");
const Synonyms = require("../utils/synonyms");
const { loadUsageStats } = require("../utils/schatAdmin/usageStats");
const {
  ChecklistRepository,
} = require("../utils/documentChecklists/repository");
const {
  summarizeDocuments,
  summarizeChecklists,
  checkGeminiConnection,
  connectionTargets,
  publicConnectionState,
} = require("../utils/schatAdmin");
const {
  classifyStorage,
  buildCleanupPreview,
  executeStorageCleanup,
  executeOriginalPdfCleanup,
  publicReport,
  loadStorageCleanupInputs,
} = require("../utils/schatAdmin/storageCleanup");

// Scanning every stored file takes ~20s on the Docker Desktop bind mount, so
// the list view reuses a recent scan. The preview below always rescans.
const STORAGE_REPORT_TTL_MS = 10 * 60 * 1000;
let storageReportCache = null;

// A deletion must follow a successful preview of exactly the same selection
// by the same admin. Tokens are single use and expire; the delete itself
// re-scans and re-validates again (see executeStorageCleanup).
const PREVIEW_TOKEN_TTL_MS = 10 * 60 * 1000;
const previewTokens = new Map();
let cleanupRunning = false;
const selectionKey = (keys) => [...new Set(keys.map(String))].sort().join(",");
function issuePreviewToken(userId, keys) {
  const now = Date.now();
  for (const [token, entry] of previewTokens)
    if (now - entry.at > PREVIEW_TOKEN_TTL_MS) previewTokens.delete(token);
  const token = crypto.randomBytes(24).toString("base64url");
  previewTokens.set(token, { userId, selection: selectionKey(keys), at: now });
  return token;
}
function consumePreviewToken(token, userId, keys) {
  const entry = previewTokens.get(String(token || ""));
  if (!entry) return false;
  previewTokens.delete(String(token));
  return (
    entry.userId === userId &&
    entry.selection === selectionKey(keys) &&
    Date.now() - entry.at <= PREVIEW_TOKEN_TTL_MS
  );
}

// Admin-only, read-only overview for the SCHAT admin screen.
function schatAdminEndpoints(app) {
  if (!app) return;

  app.get(
    "/schat-admin/status",
    [validatedRequest, flexUserRoleValid([ROLES.admin])],
    async (_request, response) => {
      try {
        const workspaces = await Workspace.where();
        const VectorDb = getVectorDbClass();
        const details = [];
        for (const workspace of workspaces) {
          const documents = await Document.where(
            { workspaceId: workspace.id },
            null,
            null,
            null,
            { docpath: true }
          );
          let vectors = null;
          try {
            vectors = await VectorDb.namespaceCount(workspace.slug);
          } catch {
            vectors = null;
          }
          details.push({
            slug: workspace.slug,
            name: workspace.name,
            documents: summarizeDocuments(documents.map((doc) => doc.docpath)),
            vectors,
            inheritsDefaultPrompt: workspace.openAiPrompt == null,
          });
        }
        let checklists = null;
        try {
          checklists = summarizeChecklists(ChecklistRepository.listAll());
        } catch {
          checklists = null;
        }
        response.status(200).json({
          workspaces: details,
          checklists,
          connections: publicConnectionState(),
        });
      } catch (e) {
        console.error("[schat-admin] status failed:", e.message);
        response.sendStatus(500).end();
      }
    }
  );

  app.post(
    "/schat-admin/connection-test",
    [validatedRequest, flexUserRoleValid([ROLES.admin])],
    async (request, response) => {
      const { target } = reqBody(request);
      const targets = connectionTargets();
      if (!["llm", "embedding"].includes(target))
        return response
          .status(400)
          .json({ ok: false, message: "잘못된 요청입니다." });
      const result = await checkGeminiConnection({
        apiKey: targets[target].apiKey,
        model: targets[target].model,
      });
      await EventLogs.logEvent(
        "schat_connection_test",
        { target, result: result.code },
        response.locals?.user?.id
      ).catch(() => null);
      response.status(200).json(result);
    }
  );

  // 저장공간 정리: report (read only). Deletion is the separate endpoint below.
  app.get(
    "/schat-admin/storage-cleanup",
    [validatedRequest, flexUserRoleValid([ROLES.admin])],
    async (request, response) => {
      try {
        const refresh = request.query?.refresh === "1";
        if (
          refresh ||
          !storageReportCache ||
          Date.now() - storageReportCache.at > STORAGE_REPORT_TTL_MS
        ) {
          const report = classifyStorage(await loadStorageCleanupInputs());
          storageReportCache = { at: Date.now(), body: publicReport(report) };
        }
        response.status(200).json({
          ...storageReportCache.body,
          scannedAt: new Date(storageReportCache.at).toISOString(),
        });
      } catch (e) {
        console.error("[schat-admin] storage report failed:", e.message);
        response.sendStatus(500).end();
      }
    }
  );

  // 삭제 전 미리보기: re-scans current data before judging the selection.
  app.post(
    "/schat-admin/storage-cleanup/preview",
    [validatedRequest, flexUserRoleValid([ROLES.admin])],
    async (request, response) => {
      try {
        const { keys = [] } = reqBody(request);
        if (!Array.isArray(keys) || keys.length === 0 || keys.length > 100)
          return response
            .status(400)
            .json({ ok: false, message: "정리할 항목을 선택해 주세요." });
        const report = classifyStorage(await loadStorageCleanupInputs());
        storageReportCache = { at: Date.now(), body: publicReport(report) };
        const preview = buildCleanupPreview(report, keys.map(String));
        response.status(200).json({
          ...preview,
          previewToken: preview.ok
            ? issuePreviewToken(response.locals?.user?.id ?? null, keys)
            : null,
        });
      } catch (e) {
        console.error("[schat-admin] storage preview failed:", e.message);
        response.sendStatus(500).end();
      }
    }
  );

  // 실제 삭제: admin only, after a matching preview. The server re-scans and
  // re-judges every item right before deleting and verifies the operational
  // counts afterwards; the browser's "삭제 가능" label is never trusted.
  app.post(
    "/schat-admin/storage-cleanup/delete",
    [validatedRequest, flexUserRoleValid([ROLES.admin])],
    async (request, response) => {
      const { keys = [], previewToken, confirm } = reqBody(request);
      const userId = response.locals?.user?.id ?? null;
      if (!Array.isArray(keys) || keys.length === 0 || keys.length > 100)
        return response
          .status(400)
          .json({ ok: false, message: "정리할 항목을 선택해 주세요." });
      if (confirm !== true)
        return response
          .status(400)
          .json({ ok: false, message: "삭제 확인이 필요합니다." });
      if (!consumePreviewToken(previewToken, userId, keys))
        return response.status(409).json({
          ok: false,
          message: "삭제 전 미리보기를 다시 확인해 주세요.",
        });
      if (cleanupRunning)
        return response
          .status(409)
          .json({ ok: false, message: "이미 정리 작업이 진행 중입니다." });
      cleanupRunning = true;
      try {
        const result = await executeStorageCleanup(keys.map(String), {
          actorId: userId,
        });
        if (result.report)
          storageReportCache = {
            at: Date.now(),
            body: publicReport(result.report),
          };
        await EventLogs.logEvent(
          "schat_storage_cleanup",
          {
            items: keys.length,
            ok: result.ok,
            stage: result.stage,
            removedFiles: result.removedFiles || 0,
            freedBytes: result.freedBytes || 0,
          },
          userId
        ).catch(() => null);
        if (result.stage === "verify")
          return response.status(409).json({
            ok: false,
            message:
              "현재 사용 중인 자료와 연결된 항목이 있어 삭제하지 않았습니다.",
            preview: result.preview,
          });
        const { report: _report, ...rest } = result;
        response.status(200).json({
          ...rest,
          message: result.ok
            ? "예전 데이터가 삭제되었습니다."
            : "삭제 후 확인에서 차이가 발견되었습니다. 관리자 확인이 필요합니다.",
        });
      } catch (e) {
        console.error("[schat-admin] storage cleanup failed:", e.message);
        response.status(500).json({
          ok: false,
          message: "삭제하지 못했습니다. 다시 확인해 주세요.",
        });
      } finally {
        cleanupRunning = false;
      }
    }
  );

  // 연결 정보가 없는 원본 PDF 삭제: admin only, explicit confirmation. Each
  // file is judged again on a fresh scan; unused ones are deleted and every
  // other selection comes back with its own reason (no partial trust of the
  // browser's "삭제 가능" label).
  app.post(
    "/schat-admin/storage-cleanup/originals/delete",
    [validatedRequest, flexUserRoleValid([ROLES.admin])],
    async (request, response) => {
      const { keys = [], confirm } = reqBody(request);
      const userId = response.locals?.user?.id ?? null;
      if (!Array.isArray(keys) || keys.length === 0 || keys.length > 100)
        return response
          .status(400)
          .json({ ok: false, message: "삭제할 원본 PDF를 선택해 주세요." });
      if (confirm !== true)
        return response
          .status(400)
          .json({ ok: false, message: "삭제 확인이 필요합니다." });
      if (cleanupRunning)
        return response
          .status(409)
          .json({ ok: false, message: "이미 정리 작업이 진행 중입니다." });
      cleanupRunning = true;
      try {
        const result = await executeOriginalPdfCleanup(keys.map(String));
        storageReportCache = {
          at: Date.now(),
          body: publicReport(result.report),
        };
        await EventLogs.logEvent(
          "schat_original_pdf_cleanup",
          {
            deleted: result.deleted,
            refused: result.refused,
            freedBytes: result.freedBytes,
            verified: result.changed.length === 0,
          },
          userId
        ).catch(() => null);
        const { report: _report, ...rest } = result;
        response.status(200).json({
          ...rest,
          message:
            result.changed.length > 0
              ? "삭제 후 확인에서 차이가 발견되었습니다. 관리자 확인이 필요합니다."
              : result.deleted > 0
                ? `연결되지 않은 원본 PDF ${result.deleted}개를 삭제했습니다.`
                : "삭제한 파일이 없습니다.",
        });
      } catch (e) {
        console.error("[schat-admin] original pdf cleanup failed:", e.message);
        response.status(500).json({
          ok: false,
          message: "삭제하지 못했습니다. 다시 확인해 주세요.",
        });
      } finally {
        cleanupRunning = false;
      }
    }
  );

  // 사용 통계 (admin only, read only, no AI calls). Cached for 5 minutes.
  app.get(
    "/schat-admin/usage-stats",
    [validatedRequest, flexUserRoleValid([ROLES.admin])],
    async (request, response) => {
      try {
        const period = String(request.query?.period || "7d");
        response.status(200).json(await loadUsageStats(period));
      } catch (e) {
        console.error("[schat-admin] usage stats failed:", e.message);
        response.sendStatus(500).end();
      }
    }
  );

  // 동의어 관리 (admin only). Drafts are added once, as "검토 필요".
  const synonymError = (response, error) =>
    response.status(400).json({
      success: false,
      error: /[가-힣]/.test(error?.message || "")
        ? error.message
        : "동의어를 저장하지 못했습니다.",
    });

  app.get(
    "/schat-admin/synonyms",
    [validatedRequest, flexUserRoleValid([ROLES.admin])],
    async (_request, response) => {
      try {
        response.status(200).json({ groups: await Synonyms.listGroups() });
      } catch (e) {
        console.error("[schat-admin] synonym list failed:", e.message);
        response.status(500).json({ groups: [] });
      }
    }
  );

  app.post(
    "/schat-admin/synonyms",
    [validatedRequest, flexUserRoleValid([ROLES.admin])],
    async (request, response) => {
      try {
        const group = await Synonyms.createGroup(reqBody(request) || {});
        response.status(200).json({ success: true, group });
      } catch (e) {
        synonymError(response, e);
      }
    }
  );

  app.put(
    "/schat-admin/synonyms/:id",
    [validatedRequest, flexUserRoleValid([ROLES.admin])],
    async (request, response) => {
      try {
        const group = await Synonyms.updateGroup(
          request.params.id,
          reqBody(request) || {}
        );
        if (!group) return response.sendStatus(404);
        response.status(200).json({ success: true, group });
      } catch (e) {
        synonymError(response, e);
      }
    }
  );

  app.delete(
    "/schat-admin/synonyms/:id",
    [validatedRequest, flexUserRoleValid([ROLES.admin])],
    async (request, response) => {
      try {
        const deleted = await Synonyms.deleteGroup(request.params.id);
        if (!deleted) return response.sendStatus(404);
        response.status(200).json({ success: true });
      } catch (e) {
        synonymError(response, e);
      }
    }
  );
}

module.exports = { schatAdminEndpoints };
