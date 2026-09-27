const fs = require("fs");
const path = require("path");
const { ChromaClient } = require("chromadb");
const prisma = require("../utils/prisma");

const ALLOWED_SCOPES = new Set(["employee", "evaluation", "test", "synthetic"]);

function readArgument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

async function main() {
  const docId = readArgument("--doc-id");
  const usageScope = readArgument("--scope");
  if (!docId || !ALLOWED_SCOPES.has(usageScope)) {
    throw new Error(
      "Usage: node schatSetDocumentScope.js --doc-id <id> --scope employee|evaluation|test|synthetic"
    );
  }

  const document = await prisma.workspace_documents.findUnique({
    where: { docId },
    include: { workspace: true },
  });
  if (!document) throw new Error("Document not found.");

  const metadata = JSON.parse(document.metadata || "{}");
  metadata.usage_scope = usageScope;
  await prisma.workspace_documents.update({
    where: { docId },
    data: { metadata: JSON.stringify(metadata) },
  });

  const storedPath = path.resolve(
    process.env.STORAGE_DIR || path.resolve(__dirname, "../storage"),
    "documents",
    document.docpath
  );
  if (fs.existsSync(storedPath)) {
    const stored = JSON.parse(fs.readFileSync(storedPath, "utf8"));
    stored.usage_scope = usageScope;
    fs.writeFileSync(storedPath, JSON.stringify(stored, null, 2), "utf8");
  }

  const mappings = await prisma.document_vectors.findMany({ where: { docId } });
  const vectorIds = mappings.map((mapping) => mapping.vectorId);
  if (vectorIds.length) {
    const client = new ChromaClient({ path: process.env.CHROMA_ENDPOINT });
    const collection = await client.getCollection({
      name: document.workspace.slug,
    });
    const current = await collection.get({
      ids: vectorIds,
      include: ["metadatas"],
    });
    await collection.update({
      ids: current.ids,
      metadatas: current.metadatas.map((item) => ({
        ...item,
        usage_scope: usageScope,
      })),
    });
  }

  console.log(
    JSON.stringify({
      updated: true,
      usage_scope: usageScope,
      vectors: vectorIds.length,
    })
  );
}

main()
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());
