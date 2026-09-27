const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const PDF_REF_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const PDF_HEADER = Buffer.from("%PDF-");

function defaultStorageRoot() {
  if (process.env.SCHAT_ORIGINAL_DOCUMENTS_DIR)
    return path.resolve(process.env.SCHAT_ORIGINAL_DOCUMENTS_DIR);
  return process.env.NODE_ENV === "production" && process.env.STORAGE_DIR
    ? path.resolve(process.env.STORAGE_DIR, "original-documents")
    : path.resolve(__dirname, "../storage/original-documents");
}

function publicOriginalPdfMetadata(metadata = {}, { storageRoot } = {}) {
  const documentId = String(metadata.document_id || "").trim();
  const title = String(metadata.title || metadata.document_name || "").trim();
  if (!documentId || !/\.pdf$/i.test(title)) return {};
  const status = originalPdfStatus(documentId, { storageRoot });
  return {
    pdfRef: status.pdfRef,
    originalPdfAvailable: status.available,
  };
}

function storagePaths(documentId, storageRoot = defaultStorageRoot()) {
  const storageKey = crypto
    .createHash("sha256")
    .update(String(documentId))
    .digest("hex");
  return {
    pdfPath: path.join(storageRoot, `${storageKey}.pdf`),
    metadataPath: path.join(storageRoot, `${storageKey}.json`),
  };
}

function ensureStorageRoot(storageRoot = defaultStorageRoot()) {
  fs.mkdirSync(storageRoot, { recursive: true });
  return storageRoot;
}

function refSecret(storageRoot = defaultStorageRoot()) {
  ensureStorageRoot(storageRoot);
  const secretPath = path.join(storageRoot, ".pdf-ref-secret");
  if (!fs.existsSync(secretPath)) {
    try {
      fs.writeFileSync(secretPath, crypto.randomBytes(32), {
        flag: "wx",
        mode: 0o600,
      });
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
    }
  }
  return fs.readFileSync(secretPath);
}

function pdfRefForDocumentId(documentId, { storageRoot } = {}) {
  if (typeof documentId !== "string" || !documentId.trim()) return null;
  const root = storageRoot || defaultStorageRoot();
  return crypto
    .createHmac("sha256", refSecret(root))
    .update(documentId.trim())
    .digest("base64url");
}

function safeOriginalName(value = "document.pdf") {
  const base = path.basename(String(value).replace(/\\/g, "/"));
  return /\.pdf$/i.test(base) ? base : "document.pdf";
}

function fileSha256(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    const stream = fs.createReadStream(filePath);
    stream.on("error", reject);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

async function assertPdfFile(sourcePath) {
  const handle = await fs.promises.open(sourcePath, "r");
  try {
    const header = Buffer.alloc(PDF_HEADER.length);
    const { bytesRead } = await handle.read(header, 0, header.length, 0);
    if (bytesRead !== PDF_HEADER.length || !header.equals(PDF_HEADER)) {
      const error = new Error("The selected file is not a valid PDF.");
      error.code = "INVALID_PDF";
      throw error;
    }
  } finally {
    await handle.close();
  }
}

function originalPdfStatus(documentId, { storageRoot } = {}) {
  if (typeof documentId !== "string" || !documentId.trim()) {
    return { available: false, pdfRef: null };
  }
  const root = storageRoot || defaultStorageRoot();
  const { pdfPath } = storagePaths(documentId.trim(), root);
  return {
    available: fs.existsSync(pdfPath),
    pdfRef: pdfRefForDocumentId(documentId.trim(), { storageRoot: root }),
  };
}

async function persistOriginalPdf({
  sourcePath,
  documentId,
  originalName,
  storageRoot,
}) {
  if (typeof documentId !== "string" || !documentId.trim()) {
    throw new Error("A document ID is required to preserve an original PDF.");
  }
  if (!/\.pdf$/i.test(String(originalName || ""))) {
    const error = new Error("Only PDF originals can be preserved.");
    error.code = "INVALID_PDF";
    throw error;
  }

  await assertPdfFile(sourcePath);
  const root = ensureStorageRoot(storageRoot || defaultStorageRoot());
  const normalizedDocumentId = documentId.trim();
  const { pdfPath, metadataPath } = storagePaths(normalizedDocumentId, root);
  const incomingHash = await fileSha256(sourcePath);

  if (fs.existsSync(pdfPath)) {
    const existingHash = await fileSha256(pdfPath);
    if (existingHash !== incomingHash) {
      const error = new Error(
        "A different original PDF is already linked to this document."
      );
      error.code = "ORIGINAL_PDF_CONFLICT";
      throw error;
    }
    return {
      created: false,
      pdfRef: pdfRefForDocumentId(normalizedDocumentId, { storageRoot: root }),
      sha256: existingHash,
    };
  }

  let createdPdf = false;
  try {
    await fs.promises.copyFile(
      sourcePath,
      pdfPath,
      fs.constants.COPYFILE_EXCL
    );
    createdPdf = true;
    await fs.promises.writeFile(
      metadataPath,
      JSON.stringify({
        filename: safeOriginalName(originalName),
        sha256: incomingHash,
        preservedAt: new Date().toISOString(),
      }),
      { encoding: "utf8", flag: "wx", mode: 0o600 }
    );
  } catch (error) {
    if (error?.code === "EEXIST" && !createdPdf) {
      const existingHash = await fileSha256(pdfPath);
      if (existingHash === incomingHash) {
        return {
          created: false,
          pdfRef: pdfRefForDocumentId(normalizedDocumentId, {
            storageRoot: root,
          }),
          sha256: existingHash,
        };
      }
      const conflict = new Error(
        "A different original PDF is already linked to this document."
      );
      conflict.code = "ORIGINAL_PDF_CONFLICT";
      throw conflict;
    }
    if (createdPdf) {
      await fs.promises.rm(pdfPath, { force: true }).catch(() => {});
      await fs.promises.rm(metadataPath, { force: true }).catch(() => {});
    }
    throw error;
  }

  return {
    created: true,
    pdfRef: pdfRefForDocumentId(normalizedDocumentId, { storageRoot: root }),
    sha256: incomingHash,
  };
}

async function removeOriginalPdf(documentId, { storageRoot } = {}) {
  if (typeof documentId !== "string" || !documentId.trim()) return;
  const root = storageRoot || defaultStorageRoot();
  const { pdfPath, metadataPath } = storagePaths(documentId.trim(), root);
  await Promise.all([
    fs.promises.rm(pdfPath, { force: true }),
    fs.promises.rm(metadataPath, { force: true }),
  ]);
}

function metadataOf(document = {}) {
  if (document.metadata && typeof document.metadata === "object")
    return document.metadata;
  try {
    return JSON.parse(document.metadata || "{}");
  } catch {
    return {};
  }
}

function resolveWorkspaceDocumentId({ pdfRef, documents = [], storageRoot }) {
  if (!PDF_REF_PATTERN.test(String(pdfRef || ""))) return null;
  const root = storageRoot || defaultStorageRoot();
  for (const document of documents) {
    const metadata = metadataOf(document);
    const documentId = String(
      metadata.document_id || document.document_id || ""
    ).trim();
    if (!documentId) continue;
    const candidate = pdfRefForDocumentId(documentId, { storageRoot: root });
    if (
      candidate.length === pdfRef.length &&
      crypto.timingSafeEqual(Buffer.from(candidate), Buffer.from(pdfRef))
    ) {
      return { documentId, metadata };
    }
  }
  return null;
}

function resolveWorkspaceOriginalPdf({ pdfRef, documents = [], storageRoot }) {
  const root = storageRoot || defaultStorageRoot();
  const match = resolveWorkspaceDocumentId({
    pdfRef,
    documents,
    storageRoot: root,
  });
  if (!match) return null;
  const { pdfPath, metadataPath } = storagePaths(match.documentId, root);
  if (!fs.existsSync(pdfPath)) return null;

  let persisted = {};
  try {
    persisted = JSON.parse(fs.readFileSync(metadataPath, "utf8"));
  } catch {}
  return {
    documentId: match.documentId,
    filePath: pdfPath,
    filename: safeOriginalName(
      persisted.filename || match.metadata.title || "document.pdf"
    ),
  };
}

function parsePdfByteRange(header, size) {
  if (typeof header !== "string" || !Number.isSafeInteger(size) || size <= 0)
    return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match || (!match[1] && !match[2])) return null;

  let start;
  let end;
  if (!match[1]) {
    const suffixLength = Number(match[2]);
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) return null;
    start = Math.max(size - suffixLength, 0);
    end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] ? Number(match[2]) : size - 1;
  }

  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    start < 0 ||
    start >= size ||
    end < start
  )
    return null;
  return { start, end: Math.min(end, size - 1) };
}

module.exports = {
  PDF_REF_PATTERN,
  defaultStorageRoot,
  pdfRefForDocumentId,
  originalPdfStatus,
  publicOriginalPdfMetadata,
  persistOriginalPdf,
  removeOriginalPdf,
  resolveWorkspaceDocumentId,
  resolveWorkspaceOriginalPdf,
  parsePdfByteRange,
};
