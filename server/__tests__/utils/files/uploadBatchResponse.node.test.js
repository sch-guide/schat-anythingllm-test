const test = require("node:test");
const assert = require("node:assert/strict");

let uploadBatch = {};
try {
  uploadBatch = require("../../../utils/files/uploadBatch");
} catch {}

test("upload response exposes normalized relative docpaths and no document contents", () => {
  assert.equal(typeof uploadBatch.buildUploadSuccessResponse, "function");

  const response = uploadBatch.buildUploadSuccessResponse([
    {
      id: "internal-source-unit-id",
      location: "custom-documents\\guide-page-1.json",
      pageContent: "hospital source text",
      metadata: { internal: true },
    },
    {
      id: "another-internal-id",
      location: "custom-documents/guide-page-2.json",
      pageContent: "more hospital source text",
    },
  ]);

  assert.deepEqual(response, {
    success: true,
    error: null,
    docpaths: [
      "custom-documents/guide-page-1.json",
      "custom-documents/guide-page-2.json",
    ],
  });
});

test("upload response drops absolute, traversal, malformed, and duplicate paths", () => {
  assert.equal(typeof uploadBatch.buildUploadSuccessResponse, "function");

  assert.deepEqual(
    uploadBatch.buildUploadSuccessResponse([
      { location: "custom-documents/safe.json" },
      { location: "custom-documents/safe.json" },
      { location: "../private/secret.json" },
      { location: "/absolute/secret.json" },
      { location: "C:\\private\\secret.json" },
      { location: "missing-folder.json" },
      { location: null },
    ]),
    {
      success: true,
      error: null,
      docpaths: ["custom-documents/safe.json"],
    }
  );
});

test("exact upload lookup exposes only picker fields and a relative docpath", () => {
  assert.equal(typeof uploadBatch.toPublicUploadPickerDocument, "function");

  const publicDocument = uploadBatch.toPublicUploadPickerDocument({
    id: "picker-id",
    name: "guide-page-1.json",
    type: "file",
    title: "Guide page 1",
    published: "2026-09-25T00:00:00.000Z",
    url: "file:///private/server/uploads/guide.pdf",
    cached: false,
    canWatch: true,
    docpath: "custom-documents/guide-page-1.json",
    pageContent: "hospital source text",
    exact_text: "hospital source text",
    document_id: "internal-document-id",
    pdf_images: [{ path: "/private/server/image.png" }],
    metadata: { internal: true },
  });

  assert.deepEqual(publicDocument, {
    id: "picker-id",
    name: "guide-page-1.json",
    type: "file",
    title: "Guide page 1",
    published: "2026-09-25T00:00:00.000Z",
    url: "guide-page-1.json",
    cached: false,
    canWatch: true,
    docpath: "custom-documents/guide-page-1.json",
  });
  assert.equal(
    JSON.stringify(publicDocument).includes("hospital source"),
    false
  );
  assert.equal(JSON.stringify(publicDocument).includes("/private/"), false);
  assert.equal(
    JSON.stringify(publicDocument).includes("internal-document-id"),
    false
  );
});

test("exact upload lookup drops malformed records instead of leaking them", () => {
  assert.equal(typeof uploadBatch.toPublicUploadPickerDocument, "function");

  assert.equal(
    uploadBatch.toPublicUploadPickerDocument({
      id: "picker-id",
      name: "secret.json",
      title: "Secret",
      docpath: "../private/secret.json",
    }),
    null
  );
  assert.equal(
    uploadBatch.toPublicUploadPickerDocument({
      name: "missing-id.json",
      title: "Missing id",
      docpath: "custom-documents/missing-id.json",
    }),
    null
  );

  assert.deepEqual(
    uploadBatch.toPublicUploadPickerDocument({
      id: "picker-id",
      name: "safe.json",
      title: "Safe",
      published: { internalPath: "/private/server/source.pdf" },
      docpath: "custom-documents/safe.json",
    }),
    {
      id: "picker-id",
      name: "safe.json",
      type: "file",
      title: "Safe",
      published: null,
      url: "safe.json",
      cached: false,
      canWatch: false,
      docpath: "custom-documents/safe.json",
    }
  );
});

test("exact upload lookup rejects requests larger than one bounded batch", () => {
  assert.equal(typeof uploadBatch.validateUploadLookupDocpaths, "function");

  assert.deepEqual(uploadBatch.validateUploadLookupDocpaths({}), {
    ok: false,
    code: 400,
    docpaths: [],
  });

  assert.deepEqual(
    uploadBatch.validateUploadLookupDocpaths([
      "custom-documents/a.json",
      "custom-documents/a.json",
      "../private/secret.json",
    ]),
    {
      ok: true,
      code: 200,
      docpaths: ["custom-documents/a.json"],
    }
  );

  const oversized = uploadBatch.validateUploadLookupDocpaths(
    Array.from(
      { length: 201 },
      (_, index) => `custom-documents/page-${index + 1}.json`
    )
  );
  assert.deepEqual(oversized, {
    ok: false,
    code: 413,
    docpaths: [],
  });
});
