const { ChromaClient } = require("chromadb");
const {
  extractRenalBiopsyChecklist,
} = require("../utils/documentChecklists/extractor");
const {
  ChecklistRepository,
} = require("../utils/documentChecklists/repository");

async function backfillRenalBiopsyChecklist({
  namespace = process.argv[2] || "schat-2026-09-22",
  repository = ChecklistRepository,
} = {}) {
  const client = new ChromaClient({ path: process.env.CHROMA_ENDPOINT });
  const collection = await client.getCollection({ name: namespace });
  const snapshot = await collection.get({ include: ["documents", "metadatas"] });
  const candidates = snapshot.ids
    .map((_, index) => ({
      text: snapshot.documents?.[index] || "",
      metadata: snapshot.metadatas?.[index] || {},
    }))
    .filter(
      ({ metadata }) =>
        String(metadata.title || "") === "검사 및 시술(26.04.07).pdf" &&
        Number(metadata.page) === 56 &&
        metadata.content_type !== "image_description"
    );

  let created = 0;
  let existing = 0;
  for (const candidate of candidates) {
    const checklist = extractRenalBiopsyChecklist({
      documentId: candidate.metadata.document_id,
      filename: candidate.metadata.title,
      page: candidate.metadata.page,
      text: candidate.text,
    });
    if (!checklist) continue;
    const saved = repository.saveAutoChecklist(checklist);
    if (saved.created) created += 1;
    else existing += 1;
  }

  return { candidates: candidates.length, created, existing };
}

if (require.main === module) {
  backfillRenalBiopsyChecklist()
    .then((result) => console.log(JSON.stringify(result)))
    .catch((error) => {
      console.error(error.message);
      process.exit(1);
    });
}

module.exports = { backfillRenalBiopsyChecklist };
