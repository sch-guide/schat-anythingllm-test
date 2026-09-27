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
  publicReport,
  loadStorageCleanupInputs,
} = require("../utils/schatAdmin/storageCleanup");

// Scanning every stored file takes ~20s on the Docker Desktop bind mount, so
// the list view reuses a recent scan. The preview below always rescans.
const STORAGE_REPORT_TTL_MS = 10 * 60 * 1000;
let storageReportCache = null;

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

  // 저장공간 정리: read-only report. No endpoint here deletes anything.
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
        response
          .status(200)
          .json(buildCleanupPreview(report, keys.map(String)));
      } catch (e) {
        console.error("[schat-admin] storage preview failed:", e.message);
        response.sendStatus(500).end();
      }
    }
  );
}

module.exports = { schatAdminEndpoints };
