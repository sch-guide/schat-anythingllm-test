// Builds procedure checklists for PDFs that were registered before the generic
// checklist engine existed. Reads stored page JSON only: no re-embedding, no
// vector or BM25 changes, no provider calls. Usage:
//   node scripts/schatBackfillProcedureChecklists.js <workspace-slug> [batch-size]
const fs = require("node:fs");
const path = require("node:path");
const {
  processDocumentChecklists,
} = require("../utils/documentChecklists/processDocuments");
const {
  ChecklistRepository,
} = require("../utils/documentChecklists/repository");

function diagnosticsPath() {
  const root =
    process.env.NODE_ENV === "production" && process.env.STORAGE_DIR
      ? path.resolve(process.env.STORAGE_DIR)
      : path.resolve(__dirname, "../storage");
  return path.join(
    root,
    "schat-diagnostics",
    "procedure-checklists-backfill.json"
  );
}

async function workspacePageDocuments(slug) {
  const prisma = require("../utils/prisma");
  const workspace = await prisma.workspaces.findFirst({ where: { slug } });
  if (!workspace) throw new Error(`Workspace not found: ${slug}`);
  const rows = await prisma.workspace_documents.findMany({
    where: { workspaceId: workspace.id },
    select: { docpath: true },
  });
  return rows
    .map((row) => ({ location: row.docpath }))
    .filter((row) => /\.pdf-page-\d+-/u.test(row.location));
}

async function backfillProcedureChecklists({
  slug = process.argv[2] || "schat-2026-09-22",
  batchSize = Number(process.argv[3]) || 20,
  repository = ChecklistRepository,
  loadDocuments = workspacePageDocuments,
  writeDiagnostics = true,
} = {}) {
  const documents = await loadDocuments(slug);
  const batches = [];
  const totals = { created: 0, skipped: 0, errors: 0, review: 0 };
  for (let start = 0; start < documents.length; start += batchSize) {
    const batch = documents.slice(start, start + batchSize);
    const saved = [];
    const result = await processDocumentChecklists(batch, {
      repository: {
        saveAutoChecklist(checklist) {
          const outcome = repository.saveAutoChecklist(checklist);
          saved.push({
            page: checklist.source?.page || checklist.page,
            title: checklist.title,
            status: outcome.checklist?.status || checklist.status,
            problems: checklist.validation?.problems || [],
            editedByAdmin: outcome.checklist?.editedByAdmin === true,
          });
          return outcome;
        },
      },
    });
    for (const key of Object.keys(totals)) totals[key] += result[key] || 0;
    batches.push({
      batch: batches.length + 1,
      pages: batch.length,
      ...result,
      checklists: saved.sort((a, b) => a.page - b.page),
    });
  }
  const report = {
    slug,
    generatedAt: new Date().toISOString(),
    documents: documents.length,
    batchSize,
    totals,
    batches,
  };
  if (writeDiagnostics) {
    const file = diagnosticsPath();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(report, null, 2), "utf8");
  }
  return report;
}

if (require.main === module) {
  backfillProcedureChecklists()
    .then((report) =>
      console.log(
        JSON.stringify({
          documents: report.documents,
          totals: report.totals,
          batches: report.batches.map(({ checklists, ...rest }) => rest),
        })
      )
    )
    .catch((error) => {
      console.error(error.message);
      process.exit(1);
    });
}

module.exports = { backfillProcedureChecklists };
