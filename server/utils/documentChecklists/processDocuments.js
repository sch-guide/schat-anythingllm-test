const crypto = require("node:crypto");
const path = require("node:path");
const { extractRenalBiopsyChecklist } = require("./extractor");
const {
  isStandardProcedurePage,
  extractProcedureChecklist,
} = require("./procedureExtractor");
const { ChecklistRepository } = require("./repository");

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

function saveResult(result, repository, checklist) {
  const saved = repository.saveAutoChecklist(checklist);
  if (checklist.status === "needs_review") result.review += 1;
  else if (saved.created) result.created += 1;
  else result.skipped += 1;
}

async function processDocumentChecklists(
  documents = [],
  {
    loadDocument = defaultLoadDocument,
    loadLayouts = defaultLoadLayouts,
    repository = ChecklistRepository,
    logger = console,
  } = {}
) {
  const result = { created: 0, skipped: 0, errors: 0, review: 0 };
  const procedurePages = new Map();

  for (const document of Array.isArray(documents) ? documents : []) {
    try {
      const data = await loadDocument(document);
      if (!data) {
        result.skipped += 1;
        continue;
      }
      // The verified Renal biopsy extractor keeps priority so p.56 stays
      // exactly as it was before the generic engine existed.
      const renal = extractRenalBiopsyChecklist({
        documentId: data.document_id,
        filename: data.title,
        page: data.page,
        text: data.pageContent,
      });
      if (renal) {
        saveResult(result, repository, renal);
        continue;
      }
      if (!data.document_id || !isStandardProcedurePage(data.pageContent)) {
        result.skipped += 1;
        continue;
      }
      const pages = procedurePages.get(data.document_id) || [];
      pages.push(data);
      procedurePages.set(data.document_id, pages);
    } catch (error) {
      result.errors += 1;
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
      result.errors += pages.length;
      logger?.warn?.(
        `[DocumentChecklists] PDF layout unavailable: ${error.message}`
      );
      continue;
    }
    for (const data of pages) {
      try {
        const checklist = extractProcedureChecklist({
          documentId,
          filename: data.title,
          page: Number(data.page),
          text: data.pageContent,
          layout: layouts?.get?.(Number(data.page)),
        });
        if (!checklist) {
          result.skipped += 1;
          continue;
        }
        saveResult(result, repository, checklist);
      } catch (error) {
        result.errors += 1;
        logger?.warn?.(
          `[DocumentChecklists] Checklist extraction skipped: ${error.message}`
        );
      }
    }
  }

  return result;
}

module.exports = { processDocumentChecklists };
