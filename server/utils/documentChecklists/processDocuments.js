const crypto = require("node:crypto");
const path = require("node:path");
const { extractRenalBiopsyChecklist } = require("./extractor");
const {
  isProcedureChecklistCandidate,
  extractProcedureChecklists,
} = require("./procedureExtractor");
const { ChecklistRepository } = require("./repository");
const {
  checklistDocumentKind,
  identityKey,
  matchPreviousVersion,
} = require("./versionMatch");

async function defaultLoadDocument(document = {}) {
  const { fileData } = require("../files");
  return fileData(document.location);
}

// Reads glyph positions from the preserved original PDF (same storage key as
// utils/originalDocuments). Missing originals simply produce no layout.
async function defaultLoadLayouts(documentId, pages = []) {
  const { defaultStorageRoot } = require("../originalDocuments");
  const { readPdfPageLayouts } = require("./pdfLayout");
  const key = crypto
    .createHash("sha256")
    .update(String(documentId))
    .digest("hex");
  return readPdfPageLayouts(
    path.join(defaultStorageRoot(), `${key}.pdf`),
    pages
  );
}

function saveResult(result, repository, checklist, versionMatch) {
  const saved = repository.saveAutoChecklist(checklist, { versionMatch });
  if (saved?.autoPublished) result.autoPublished += 1;
  else if (checklist.status === "needs_review") result.review += 1;
  else if (saved?.created) result.created += 1;
  else result.skipped += 1;
}

function existingChecklists(repository) {
  try {
    return typeof repository.listAll === "function" ? repository.listAll() : [];
  } catch {
    return [];
  }
}

/**
 * Creates checklists for newly processed pages of the "검사 및 시술" and 수술
 * handbooks only; other documents (general guidelines, prose) are skipped.
 * A page of a new edition that reads exactly like a public checklist of an
 * earlier edition is published again; everything else waits for review.
 * Checklist problems never reject the PDF upload: they are counted, listed in
 * result.failures (document + page + title + reason code, no page text) and
 * passed to onIssues.
 */
async function processDocumentChecklists(
  documents = [],
  {
    loadDocument = defaultLoadDocument,
    loadLayouts = defaultLoadLayouts,
    repository = ChecklistRepository,
    logger = console,
    onIssues = null,
  } = {}
) {
  const result = {
    created: 0,
    skipped: 0,
    errors: 0,
    review: 0,
    autoPublished: 0,
    failures: [],
  };
  const fail = (failure) => {
    result.errors += 1;
    result.failures.push(failure);
  };
  const procedurePages = new Map();
  const extracted = [];

  for (const document of Array.isArray(documents) ? documents : []) {
    try {
      const data = await loadDocument(document);
      if (!data) {
        result.skipped += 1;
        continue;
      }
      if (!checklistDocumentKind(data.title)) {
        result.skipped += 1;
        continue;
      }
      // The verified Renal biopsy extractor keeps priority so its checklist
      // stays exactly as it was before the generic engine existed.
      const renal = extractRenalBiopsyChecklist({
        documentId: data.document_id,
        filename: data.title,
        page: data.page,
        text: data.pageContent,
      });
      if (renal) {
        extracted.push(renal);
        continue;
      }
      if (
        !data.document_id ||
        !isProcedureChecklistCandidate(data.pageContent)
      ) {
        result.skipped += 1;
        continue;
      }
      const pages = procedurePages.get(data.document_id) || [];
      pages.push(data);
      procedurePages.set(data.document_id, pages);
    } catch (error) {
      fail({
        document: document?.location || null,
        page: null,
        title: null,
        reason: "read-failed",
      });
      logger?.warn?.(
        `[DocumentChecklists] Checklist extraction skipped: ${error.message}`
      );
    }
  }

  for (const [documentId, pages] of procedurePages) {
    let layouts;
    try {
      layouts = await loadLayouts(
        documentId,
        pages.map((page) => Number(page.page))
      );
    } catch (error) {
      for (const page of pages)
        fail({
          document: page.title,
          page: Number(page.page),
          title: null,
          reason: "pdf-layout-unavailable",
        });
      logger?.warn?.(
        `[DocumentChecklists] PDF layout unavailable: ${error.message}`
      );
      continue;
    }
    for (const data of pages) {
      const page = Number(data.page);
      const layout = layouts?.get?.(page);
      // The page text matches a checklist form, so an empty layout means the
      // preserved original PDF or pdf.js could not be read: report it instead
      // of skipping the page silently.
      if (!layout?.items?.length) {
        fail({
          document: data.title,
          page,
          title: null,
          reason: "pdf-layout-unavailable",
        });
        continue;
      }
      try {
        const checklists = extractProcedureChecklists({
          documentId,
          filename: data.title,
          page,
          text: data.pageContent,
          layout,
        });
        if (!checklists.length) {
          fail({
            document: data.title,
            page,
            title: null,
            reason: "layout-not-recognised",
          });
          continue;
        }
        extracted.push(...checklists);
      } catch (error) {
        fail({
          document: data.title,
          page,
          title: null,
          reason: "extract-failed",
        });
        logger?.warn?.(
          `[DocumentChecklists] Checklist extraction skipped: ${error.message}`
        );
      }
    }
  }

  // Compare with earlier editions: taken once, before this upload saves
  // anything, so checklists of the same upload never match each other.
  const existing = existingChecklists(repository);
  const titleCounts = new Map();
  for (const checklist of extracted) {
    const key = `${checklist.documentId}\u0000${identityKey(checklist)}`;
    titleCounts.set(key, (titleCounts.get(key) || 0) + 1);
  }
  for (const checklist of extracted) {
    try {
      const key = `${checklist.documentId}\u0000${identityKey(checklist)}`;
      const versionMatch = matchPreviousVersion(checklist, existing, {
        duplicateInDocument: titleCounts.get(key) > 1,
      });
      saveResult(result, repository, checklist, versionMatch);
    } catch (error) {
      fail({
        document: checklist.source?.filename || null,
        page: Number(checklist.page) || null,
        title: checklist.title || null,
        reason: "save-failed",
      });
      logger?.warn?.(
        `[DocumentChecklists] Checklist save failed: ${error.message}`
      );
    }
  }

  if (result.failures.length) {
    const pages = result.failures
      .map((failure) => `${failure.page ?? "?"}:${failure.reason}`)
      .join(", ");
    logger?.warn?.(
      `[DocumentChecklists] ${result.failures.length} checklist page(s) not created: ${pages}`
    );
    try {
      await onIssues?.(result);
    } catch {
      // reporting must never break the upload
    }
  }
  return result;
}

/** Records checklist extraction problems in the administrator system log. */
async function logChecklistIssues(result, userId = null) {
  const { EventLogs } = require("../../models/eventLogs");
  const reasons = {};
  for (const failure of result.failures || [])
    reasons[failure.reason] = (reasons[failure.reason] || 0) + 1;
  await EventLogs.logEvent(
    "checklist_extraction_issue",
    {
      failedPages: (result.failures || [])
        .map((failure) => failure.page)
        .filter((page) => page !== null)
        .slice(0, 100)
        .join(","),
      reasons: JSON.stringify(reasons),
      failures: JSON.stringify(
        (result.failures || []).slice(0, 100).map((failure) => ({
          document: failure.document || null,
          page: failure.page ?? null,
          title: failure.title || null,
          reason: failure.reason,
        }))
      ),
      created: result.created + result.review + result.autoPublished,
    },
    userId
  );
}

module.exports = { processDocumentChecklists, logChecklistIssues };
