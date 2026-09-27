import test from "node:test";
import assert from "node:assert/strict";

let uploadBatch = {};
try {
  uploadBatch = await import("./uploadBatch.js");
} catch {}

test("more than 100 uploaded documents are selected without selecting older files", () => {
  assert.equal(typeof uploadBatch.uploadedFileIdsForFolder, "function");

  const oldFiles = Array.from({ length: 82 }, (_, index) => ({
    id: `old-${index + 1}`,
    name: `old-${index + 1}.json`,
  }));
  const uploadedFiles = Array.from({ length: 182 }, (_, index) => ({
    id: `new-${index + 1}`,
    name: `new-${index + 1}.json`,
  }));
  const uploadedDocpaths = uploadedFiles.map(
    ({ name }) => `custom-documents/${name}`
  );

  assert.deepEqual(
    uploadBatch.uploadedFileIdsForFolder({
      folderName: "custom-documents",
      files: [...oldFiles, ...uploadedFiles],
      uploadedDocpaths,
      embeddedDocpaths: [],
    }),
    uploadedFiles.map(({ id }) => id)
  );
});

test("upload completions are accumulated, deduplicated, and failed uploads add nothing", () => {
  assert.equal(typeof uploadBatch.mergeUploadCompletion, "function");

  const first = uploadBatch.mergeUploadCompletion([], {
    success: true,
    docpaths: ["custom-documents/a.json", "custom-documents/b.json"],
  });
  const second = uploadBatch.mergeUploadCompletion(first, {
    success: true,
    docpaths: ["custom-documents/b.json", "ward/c.json"],
  });
  const failed = uploadBatch.mergeUploadCompletion(second, {
    success: false,
    docpaths: ["custom-documents/failed.json"],
  });

  assert.deepEqual(failed, [
    "custom-documents/a.json",
    "custom-documents/b.json",
    "ward/c.json",
  ]);
  assert.deepEqual(uploadBatch.uploadedFolderNames(failed), [
    "custom-documents",
    "ward",
  ]);
});

test("already embedded uploaded paths are not selected", () => {
  assert.equal(typeof uploadBatch.uploadedFileIdsForFolder, "function");

  assert.deepEqual(
    uploadBatch.uploadedFileIdsForFolder({
      folderName: "custom-documents",
      files: [
        { id: "embedded", name: "embedded.json" },
        { id: "fresh", name: "fresh.json" },
      ],
      uploadedDocpaths: [
        "custom-documents/embedded.json",
        "custom-documents/fresh.json",
      ],
      embeddedDocpaths: ["custom-documents/embedded.json"],
    }),
    ["fresh"]
  );
});

test("exact uploaded documents are fetched in bounded batches without reading a folder", async () => {
  assert.equal(typeof uploadBatch.fetchUploadedBatchRecords, "function");

  const uploadedDocpaths = Array.from(
    { length: 501 },
    (_, index) => `custom-documents/page-${index + 1}.json`
  );
  const calls = [];
  const records = await uploadBatch.fetchUploadedBatchRecords({
    uploadedDocpaths,
    embeddedDocpaths: ["custom-documents/page-2.json"],
    fetchByDocpaths: async (docpaths) => {
      calls.push([...docpaths]);
      return [
        ...docpaths.map((docpath) => {
          const name = docpath.split("/")[1];
          return {
            id: `id-${name}`,
            name,
            type: "file",
            title: name,
            published: "2026-09-25T00:00:00.000Z",
            url: name,
            cached: false,
            canWatch: false,
            docpath,
            metadata: { mustNotReachThePicker: true },
          };
        }),
        {
          id: "unrequested",
          name: "unrequested.json",
          title: "unrequested",
          docpath: "custom-documents/unrequested.json",
        },
      ];
    },
  });

  assert.deepEqual(calls.map((call) => call.length), [200, 200, 101]);
  assert.equal(records.length, 500);
  assert.equal(
    records.some(({ docpath }) => docpath === "custom-documents/page-2.json"),
    false
  );
  assert.equal(
    records.every(({ folderName }) => folderName === "custom-documents"),
    true
  );
  assert.equal(records.some(({ file }) => "metadata" in file), false);
  assert.equal(
    records.some(({ docpath }) => docpath === "custom-documents/unrequested.json"),
    false
  );
});

test("uploaded selections outside the visible page still resolve for embedding", () => {
  assert.equal(typeof uploadBatch.resolveUploadedSelectionRecords, "function");

  const resolved = uploadBatch.resolveUploadedSelectionRecords({
    records: [
      {
        folderName: "custom-documents",
        file: { id: "visible", name: "visible.json" },
      },
      {
        folderName: "custom-documents",
        file: { id: "hidden", name: "hidden.json" },
      },
      {
        folderName: "custom-documents",
        file: { id: "not-selected", name: "not-selected.json" },
      },
      {
        folderName: "custom-documents",
        file: { id: "embedded", name: "embedded.json" },
      },
    ],
    selectedIds: new Set(["visible", "hidden", "embedded"]),
    seenIds: new Set(["visible"]),
    embeddedDocpaths: new Set(["custom-documents/embedded.json"]),
  });

  assert.deepEqual(resolved, [
    {
      id: "hidden",
      name: "hidden.json",
      folderName: "custom-documents",
    },
  ]);
});

test("exact upload lookup rejects a partial response but permits embedded omissions", async () => {
  assert.equal(typeof uploadBatch.fetchUploadedBatchRecords, "function");

  await assert.rejects(
    uploadBatch.fetchUploadedBatchRecords({
      uploadedDocpaths: [
        "custom-documents/a.json",
        "custom-documents/b.json",
      ],
      fetchByDocpaths: async () => [
        {
          id: "a",
          name: "a.json",
          title: "A",
          docpath: "custom-documents/a.json",
        },
      ],
    }),
    /Uploaded document lookup incomplete/
  );

  const records = await uploadBatch.fetchUploadedBatchRecords({
    uploadedDocpaths: [
      "custom-documents/a.json",
      "custom-documents/b.json",
    ],
    embeddedDocpaths: ["custom-documents/b.json"],
    fetchByDocpaths: async () => [
      {
        id: "a",
        name: "a.json",
        title: "A",
        docpath: "custom-documents/a.json",
      },
    ],
  });
  assert.deepEqual(records.map(({ docpath }) => docpath), [
    "custom-documents/a.json",
  ]);
});

test("upload sync reports a lookup failure instead of silently selecting zero files", async () => {
  assert.equal(typeof uploadBatch.runUploadCompletionSync, "function");

  assert.deepEqual(
    await uploadBatch.runUploadCompletionSync({
      docpaths: ["custom-documents/a.json"],
      onUploadComplete: async () => {
        throw new Error("lookup failed");
      },
    }),
    { ok: false }
  );
});

test("a failed refresh preserves known embedded paths", () => {
  assert.equal(typeof uploadBatch.workspaceDocpathsForRefresh, "function");

  const fallback = new Set([
    "custom-documents/embedded-a.json",
    "custom-documents/embedded-b.json",
  ]);
  assert.deepEqual(uploadBatch.workspaceDocpathsForRefresh(null, fallback), [
    "custom-documents/embedded-a.json",
    "custom-documents/embedded-b.json",
  ]);
  assert.deepEqual(
    uploadBatch.workspaceDocpathsForRefresh(
      { documents: [{ docpath: "custom-documents/current.json" }] },
      fallback
    ),
    ["custom-documents/current.json"]
  );
});
