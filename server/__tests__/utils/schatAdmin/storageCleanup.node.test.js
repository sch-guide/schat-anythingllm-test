const test = require("node:test");
const assert = require("node:assert/strict");

const {
  STATUS,
  classifyStorage,
  buildCleanupPreview,
  buildCleanupManifest,
  compareOperationalSnapshots,
  publicReport,
  originalStorageKey,
} = require("../../../utils/schatAdmin/storageCleanup");

// Synthetic ids and names only.
const CURRENT = "11111111-aaaa-4aaa-8aaa-000000000001";
const OLD = "22222222-bbbb-4bbb-8bbb-000000000002";
const CHECKLIST_ONLY = "33333333-cccc-4ccc-8ccc-000000000003";
const STRAY_FOLDER = "44444444-dddd-4ddd-8ddd-000000000004";

function pages(documentId, title, count, published = "2026-09-20T00:00:00Z") {
  return Array.from({ length: count }, (_, i) => ({
    fileName: `${title}-page-${i + 1}-${documentId}.json`,
    documentId,
    title,
    page: i + 1,
    published,
    bytes: 100,
  }));
}

function fixture(overrides = {}) {
  const current = pages(CURRENT, "가상지침.pdf", 3, "2026-09-25T00:00:00Z");
  return {
    pageRecords: [
      ...current,
      ...pages(OLD, "가상지침.pdf", 3),
      ...pages(CHECKLIST_ONLY, "가상검사.pdf", 2),
    ],
    workspaceDocs: current.map((r, i) => ({
      docpath: `custom-documents/${r.fileName}`,
      docId: `ws-${i}`,
      imageFolders: [CURRENT],
    })),
    vectorDocIds: new Set(["ws-0", "ws-1", "ws-2"]),
    chromaDocumentIds: new Set([CURRENT]),
    checklistDocumentIds: new Map([[CHECKLIST_ONLY, 4]]),
    imageFolders: [
      { name: CURRENT, files: 5, bytes: 5000 },
      { name: OLD, files: 5, bytes: 5000 },
      { name: STRAY_FOLDER, files: 2, bytes: 700 },
    ],
    originals: [
      { storageKey: originalStorageKey(CURRENT), bytes: 900 },
      { storageKey: originalStorageKey(OLD), bytes: 900 },
      { storageKey: "f".repeat(64), bytes: 300 },
    ],
    descriptionCache: { files: 7, bytes: 70 },
    vectorCounts: { body: 3, image: 5 },
    ...overrides,
  };
}

const byTitle = (report, kind) => report.groups.filter((g) => g.kind === kind);

test("groups by upload and protects everything the live workspace uses", () => {
  const report = classifyStorage(fixture());
  const uploads = byTitle(report, "upload");
  const current = uploads.find((g) => g.usage.workspacePages > 0);
  const old = uploads.find(
    (g) => g.title === "가상지침.pdf" && g.usage.workspacePages === 0
  );
  const checklistOnly = uploads.find((g) => g.title === "가상검사.pdf");

  assert.equal(current.status, STATUS.IN_USE);
  assert.equal(current.original.inUse, true);
  assert.equal(old.status, STATUS.OLD_UPLOAD);
  assert.deepEqual(
    [old.pages, old.pageRecords, old.imageFiles, old.imageBytes],
    [3, 3, 5, 5000]
  );
  assert.equal(old.original.exists, true);
  // referenced by a checklist even though not in the workspace
  assert.equal(checklistOnly.status, STATUS.IN_USE);

  const stray = byTitle(report, "image_folder")[0];
  assert.equal(stray.status, STATUS.UNLINKED);
  const unknownOriginal = byTitle(report, "original")[0];
  assert.equal(unknownOriginal.status, STATUS.REVIEW);

  assert.deepEqual(report.summary.current, {
    documents: 1,
    pages: 3,
    bodyVectors: 3,
    imageVectors: 5,
    checklists: 4,
    originals: 1,
  });
  assert.equal(report.summary.cleanup.oldUploads, 1);
  assert.equal(report.summary.cleanup.unlinked, 1);
  assert.equal(report.summary.cleanup.pageRecords, 3);
  assert.equal(report.summary.cleanup.imageBytes, 5700);
});

test("any vector or image reference alone keeps an upload protected", () => {
  const vectorOnly = classifyStorage(
    fixture({ chromaDocumentIds: new Set([CURRENT, OLD]) })
  );
  assert.equal(
    vectorOnly.groups.find(
      (g) =>
        g.kind === "upload" &&
        g.usage.chromaReferenced &&
        g.usage.workspacePages === 0
    ).status,
    STATUS.IN_USE
  );
  const imageOnly = classifyStorage(
    fixture({
      workspaceDocs: fixture().workspaceDocs.map((d) => ({
        ...d,
        imageFolders: [CURRENT, STRAY_FOLDER],
      })),
    })
  );
  assert.equal(
    imageOnly.groups.find((g) => g.kind === "image_folder").status,
    STATUS.IN_USE
  );
});

test("preview blocks protected, review and vector-linked selections", () => {
  const report = classifyStorage(fixture());
  const find = (fn) => report.groups.find(fn).key;
  const oldKey = find((g) => g.status === STATUS.OLD_UPLOAD);
  const strayKey = find((g) => g.status === STATUS.UNLINKED);
  const currentKey = find(
    (g) => g.status === STATUS.IN_USE && g.usage.workspacePages > 0
  );
  const reviewKey = find((g) => g.status === STATUS.REVIEW);

  const ok = buildCleanupPreview(report, [oldKey, strayKey]);
  assert.equal(ok.ok, true);
  assert.equal(ok.remove.pageRecords, 3);
  assert.equal(ok.remove.imageFolders, 2);
  assert.equal(ok.remove.imageFiles, 7);
  assert.equal(ok.remove.originals, 1);
  assert.equal(ok.remove.bytes, 300 + 5000 + 900 + 700);
  assert.deepEqual(ok.keep.descriptionCache, { files: 7, bytes: 70 });

  const blocked = buildCleanupPreview(report, [
    oldKey,
    currentKey,
    reviewKey,
    "nope",
  ]);
  assert.equal(blocked.ok, false);
  assert.equal(blocked.blocked.length, 3);
  assert.match(blocked.blocked[0].reason, /현재 검색 데이터와 연결/);

  assert.equal(buildCleanupPreview(report, []).ok, false);
});

test("browser payloads never contain document ids", () => {
  const report = classifyStorage(fixture());
  const json = JSON.stringify(publicReport(report));
  for (const id of [CURRENT, OLD, CHECKLIST_ONLY, STRAY_FOLDER])
    assert.equal(json.includes(id), false);
  const preview = JSON.stringify(
    buildCleanupPreview(report, [
      report.groups.find((g) => g.status === STATUS.OLD_UPLOAD).key,
    ])
  );
  assert.equal(preview.includes(OLD), false);
});

test("manifest and post-deletion comparison are ready but nothing is deleted", () => {
  const report = classifyStorage(fixture());
  const key = report.groups.find((g) => g.status === STATUS.OLD_UPLOAD).key;
  const manifest = buildCleanupManifest(report, [key], {
    adminUsername: "admin-test",
    at: new Date("2026-09-27T00:00:00Z"),
  });
  assert.equal(manifest.fileName, "cleanup-manifest-2026-09-27.json");
  assert.equal(manifest.items[0].documentId, OLD);
  assert.equal(manifest.items[0].pageRecords, 3);
  assert.equal(manifest.verified, false);

  const same = compareOperationalSnapshots(report.summary.current, {
    ...report.summary.current,
  });
  assert.equal(same.ok, true);
  const changed = compareOperationalSnapshots(report.summary.current, {
    ...report.summary.current,
    imageVectors: 4,
  });
  assert.deepEqual(changed.changed, [
    { field: "imageVectors", before: 5, after: 4 },
  ]);
});
