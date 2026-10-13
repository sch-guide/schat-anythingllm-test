const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const {
  previewDocumentUpdates,
} = require("../../utils/documentUpdates/preview");

async function fixture(t, documents) {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), "schat-update-preview-")
  );
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, "custom-documents"));
  for (const [name, data] of Object.entries(documents)) {
    await fs.writeFile(
      path.join(root, "custom-documents", name),
      JSON.stringify(data)
    );
  }
  return root;
}

test("preview groups every page of matching documents and does not modify files", async (t) => {
  const root = await fixture(t, {
    "first.json": {
      title: "테스트.pdf",
      document_id: "old",
      page: 1,
      pageContent: "not returned",
    },
    "second.json": { title: "테스트.pdf", document_id: "old", page: 2 },
    "other.json": { title: "다른자료.pdf", document_id: "other" },
  });
  const before = await fs.readFile(
    path.join(root, "custom-documents/first.json"),
    "utf8"
  );
  const result = await previewDocumentUpdates({
    root,
    names: ["테스트.pdf", "신규.pdf"],
  });
  assert.deepEqual(result, {
    conflicts: [
      {
        name: "테스트.pdf",
        documents: [
          { docpath: "custom-documents/first.json", documentId: "old" },
          { docpath: "custom-documents/second.json", documentId: "old" },
        ],
      },
    ],
  });
  assert.equal(
    await fs.readFile(path.join(root, "custom-documents/first.json"), "utf8"),
    before
  );
  assert.equal(JSON.stringify(result).includes("not returned"), false);
});

test("Unicode composition and extension case do not bypass duplicate detection", async (t) => {
  const root = await fixture(t, {
    "old.json": { title: "하위폴더/테스트.PDF", document_id: "old" },
  });
  const result = await previewDocumentUpdates({
    root,
    names: ["테스트.pdf".normalize("NFD")],
  });
  assert.equal(result.conflicts.length, 1);
  assert.equal(result.conflicts[0].documents[0].documentId, "old");
});

test("multiple old versions are all returned, not just the first matching page", async (t) => {
  const root = await fixture(t, {
    "a.json": { title: "sample.pdf", document_id: "v1" },
    "b.json": { title: "sample.pdf", document_id: "v2" },
  });
  const result = await previewDocumentUpdates({ root, names: ["sample.pdf"] });
  assert.deepEqual(
    result.conflicts[0].documents.map((d) => d.documentId),
    ["v1", "v2"]
  );
});

test("rejects ambiguous duplicate names within the upload batch before any upload", async (t) => {
  const root = await fixture(t, {});
  await assert.rejects(
    previewDocumentUpdates({ root, names: ["a.pdf", "A.PDF"] }),
    /DUPLICATE_BATCH_NAME/
  );
});

test("damaged metadata fails closed instead of reporting that no old document exists", async (t) => {
  const root = await fixture(t, { "bad.json": {} });
  await assert.rejects(
    previewDocumentUpdates({ root, names: ["a.pdf"] }),
    /DOCUMENT_IDENTITY_UNAVAILABLE/
  );
});

test("missing directory is not silently treated as an empty catalog", async () => {
  await assert.rejects(
    previewDocumentUpdates({
      root: path.join(os.tmpdir(), "schat-missing-" + randomUUID()),
      names: ["a.pdf"],
    })
  );
});

test("spreadsheet sheet titles retain the original upload identity through the collector file URL", async (t) => {
  const root = await fixture(t, {
    "sheet.json": {
      title: "example.xlsx - Sheet:Demo",
      url: "file://C:/collector/hotdir/example.xlsx",
    },
  });
  const result = await previewDocumentUpdates({
    root,
    names: ["example.xlsx"],
  });
  assert.deepEqual(result.conflicts[0].documents, [
    { docpath: "custom-documents/sheet.json", documentId: null },
  ]);
});

test("invalid JSON rejects the preview without overwriting the damaged file", async (t) => {
  const root = await fixture(t, {});
  const filename = path.join(root, "custom-documents/broken.json");
  await fs.writeFile(filename, "{incomplete");
  await assert.rejects(
    previewDocumentUpdates({ root, names: ["a.pdf"] }),
    /DOCUMENT_IDENTITY_UNAVAILABLE/
  );
  assert.equal(await fs.readFile(filename, "utf8"), "{incomplete");
});

test("rejects path traversal and empty input", async (t) => {
  const root = await fixture(t, {});
  for (const names of [[], ["../a.pdf"], [""], ["a\u0000.pdf"]]) {
    await assert.rejects(
      previewDocumentUpdates({ root, names }),
      /INVALID_UPLOAD_NAMES/
    );
  }
});

test("작업공간에서 뺀 문서의 남은 쪽 파일은 기존 자료로 보지 않음", async () => {
  const fs = require("node:fs/promises");
  const os = require("node:os");
  const path = require("node:path");
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "schat-preview-"));
  try {
    await fs.mkdir(path.join(root, "custom-documents"));
    for (const name of ["a.json", "b.json"])
      await fs.writeFile(
        path.join(root, "custom-documents", name),
        JSON.stringify({ title: "검사.pdf", document_id: "d1" })
      );
    const all = await previewDocumentUpdates({ root, names: ["검사.pdf"] });
    assert.equal(all.conflicts[0].documents.length, 2);
    const none = await previewDocumentUpdates({
      root,
      names: ["검사.pdf"],
      registered: new Set(),
    });
    assert.deepEqual(none.conflicts, []);
    const one = await previewDocumentUpdates({
      root,
      names: ["검사.pdf"],
      registered: new Set(["custom-documents/a.json"]),
    });
    assert.deepEqual(
      one.conflicts[0].documents.map((d) => d.docpath),
      ["custom-documents/a.json"]
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
