const test = require("node:test");
const assert = require("node:assert/strict");

const {
  prepareOriginalPdfUpload,
} = require("../../utils/originalPdfUpload");

test("prepares a stable document id and preserves a GUI PDF before collection", async () => {
  const calls = [];
  const result = await prepareOriginalPdfUpload({
    file: {
      path: "/temporary/guide.pdf",
      originalname: "guide.pdf",
      mimetype: "application/pdf",
    },
    metadata: { title: "guide.pdf" },
    createDocumentId: () => "stable-document-id",
    persist: async (input) => {
      calls.push(input);
      return { created: true, pdfRef: "opaque-ref" };
    },
  });

  assert.equal(result.metadata.document_id, "stable-document-id");
  assert.equal(result.preserved.created, true);
  assert.deepEqual(calls, [
    {
      sourcePath: "/temporary/guide.pdf",
      documentId: "stable-document-id",
      originalName: "guide.pdf",
    },
  ]);
});

test("does not alter non-PDF upload processing", async () => {
  let persistCalled = false;
  const result = await prepareOriginalPdfUpload({
    file: {
      path: "/temporary/notes.txt",
      originalname: "notes.txt",
      mimetype: "text/plain",
    },
    metadata: { title: "notes.txt" },
    persist: async () => {
      persistCalled = true;
    },
  });

  assert.deepEqual(result, {
    metadata: { title: "notes.txt" },
    preserved: null,
  });
  assert.equal(persistCalled, false);
});
