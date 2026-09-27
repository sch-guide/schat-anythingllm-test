const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const {
  persistOriginalPdf,
  pdfRefForDocumentId,
  originalPdfStatus,
  resolveWorkspaceOriginalPdf,
  parsePdfByteRange,
} = require("../../utils/originalDocuments");

function tempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "schat-original-pdf-"));
}

function writePdf(target, body = "first") {
  fs.writeFileSync(target, Buffer.from(`%PDF-1.7\n${body}\n%%EOF`, "utf8"));
}

test("stores one validated PDF and returns a stable opaque public reference", async () => {
  const storageRoot = tempRoot();
  const sourcePath = path.join(storageRoot, "upload.pdf");
  const documentId = "hospital-document-1";
  writePdf(sourcePath);

  const first = await persistOriginalPdf({
    sourcePath,
    documentId,
    originalName: "guide.pdf",
    storageRoot,
  });
  const second = await persistOriginalPdf({
    sourcePath,
    documentId,
    originalName: "guide.pdf",
    storageRoot,
  });

  assert.equal(first.created, true);
  assert.equal(second.created, false);
  assert.equal(first.pdfRef, second.pdfRef);
  assert.match(first.pdfRef, /^[A-Za-z0-9_-]{43}$/);
  assert.doesNotMatch(first.pdfRef, /hospital-document-1/);
  assert.equal(originalPdfStatus(documentId, { storageRoot }).available, true);
});

test("rejects a renamed non-PDF before it reaches permanent storage", async () => {
  const storageRoot = tempRoot();
  const sourcePath = path.join(storageRoot, "fake.pdf");
  fs.writeFileSync(sourcePath, "not a pdf", "utf8");

  await assert.rejects(
    persistOriginalPdf({
      sourcePath,
      documentId: "hospital-document-2",
      originalName: "fake.pdf",
      storageRoot,
    }),
    /valid PDF/i
  );
  assert.equal(
    originalPdfStatus("hospital-document-2", { storageRoot }).available,
    false
  );
});

test("does not silently replace a linked document with different PDF bytes", async () => {
  const storageRoot = tempRoot();
  const firstPath = path.join(storageRoot, "first.pdf");
  const secondPath = path.join(storageRoot, "second.pdf");
  writePdf(firstPath, "first version");
  writePdf(secondPath, "different version");

  await persistOriginalPdf({
    sourcePath: firstPath,
    documentId: "hospital-document-3",
    originalName: "guide.pdf",
    storageRoot,
  });
  await assert.rejects(
    persistOriginalPdf({
      sourcePath: secondPath,
      documentId: "hospital-document-3",
      originalName: "guide.pdf",
      storageRoot,
    }),
    (error) => error?.code === "ORIGINAL_PDF_CONFLICT"
  );
});

test("resolves a PDF only when the opaque reference belongs to a workspace document", async () => {
  const storageRoot = tempRoot();
  const sourcePath = path.join(storageRoot, "guide.pdf");
  writePdf(sourcePath);
  await persistOriginalPdf({
    sourcePath,
    documentId: "hospital-document-4",
    originalName: "guide.pdf",
    storageRoot,
  });
  const pdfRef = pdfRefForDocumentId("hospital-document-4", { storageRoot });
  const documents = [
    {
      metadata: JSON.stringify({
        document_id: "hospital-document-4",
        title: "guide.pdf",
      }),
    },
  ];

  const resolved = resolveWorkspaceOriginalPdf({
    pdfRef,
    documents,
    storageRoot,
  });
  const denied = resolveWorkspaceOriginalPdf({
    pdfRef,
    documents: [
      { metadata: JSON.stringify({ document_id: "another-document" }) },
    ],
    storageRoot,
  });

  assert.equal(resolved?.filename, "guide.pdf");
  assert.equal(fs.existsSync(resolved?.filePath), true);
  assert.equal(denied, null);
});

test("parses safe single byte ranges and rejects malformed or multi ranges", () => {
  assert.deepEqual(parsePdfByteRange("bytes=10-19", 100), {
    start: 10,
    end: 19,
  });
  assert.deepEqual(parsePdfByteRange("bytes=90-", 100), {
    start: 90,
    end: 99,
  });
  assert.deepEqual(parsePdfByteRange("bytes=-10", 100), {
    start: 90,
    end: 99,
  });
  assert.equal(parsePdfByteRange("bytes=100-101", 100), null);
  assert.equal(parsePdfByteRange("bytes=0-1,4-5", 100), null);
  assert.equal(parsePdfByteRange("items=0-1", 100), null);
});
