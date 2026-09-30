// 연결 정보가 없는 원본 PDF 삭제: only an original that no known document id
// points to is deletable; everything else is refused with its own reason.
// Temporary folders and synthetic ids only.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  STATUS,
  classifyStorage,
  buildCleanupPreview,
  executeOriginalPdfCleanup,
  publicReport,
  originalStorageKey,
} = require("../../../utils/schatAdmin/storageCleanup");

const LIVE = "aaaaaaaa-1111-4111-8111-000000000001"; // workspace document
const ORPHAN_1 = "bbbbbbbb-2222-4222-8222-000000000002"; // referenced nowhere
const ORPHAN_2 = "cccccccc-3333-4333-8333-000000000003"; // referenced nowhere
const CHAT_ONLY = "dddddddd-4444-4444-8444-000000000004"; // old answer source
const QUIZ_ONLY = "eeeeeeee-5555-4555-8555-000000000005"; // quiz document_id
const CHECKLIST_ONLY = "ffffffff-6666-4666-8666-000000000006";
const CHROMA_ONLY = "99999999-7777-4777-8777-000000000007";

function setup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "schat-originals-"));
  const originals = path.join(root, "original-documents");
  const pages = path.join(root, "documents", "custom-documents");
  fs.mkdirSync(originals, { recursive: true });
  fs.mkdirSync(pages, { recursive: true });
  // an unrelated file that must survive any deletion
  fs.writeFileSync(path.join(root, "anythingllm.db"), "db");
  const ids = [
    LIVE,
    ORPHAN_1,
    ORPHAN_2,
    CHAT_ONLY,
    QUIZ_ONLY,
    CHECKLIST_ONLY,
    CHROMA_ONLY,
  ];
  for (const id of ids) {
    const key = originalStorageKey(id);
    fs.writeFileSync(path.join(originals, `${key}.pdf`), "%PDF-".repeat(200));
    fs.writeFileSync(path.join(originals, `${key}.json`), "{}");
  }
  const livePage = `live-page-1-${LIVE}.json`;
  fs.writeFileSync(path.join(pages, livePage), "{}");

  const loadInputs = async ({ complete = true } = {}) => ({
    pageRecords: [
      {
        fileName: livePage,
        documentId: LIVE,
        title: "가상지침.pdf",
        page: 1,
        bytes: 2,
      },
    ],
    workspaceDocs: [
      {
        docpath: `custom-documents/${livePage}`,
        docId: "ws-1",
        imageFolders: [],
      },
    ],
    vectorDocIds: new Set(["ws-1"]),
    chromaDocumentIds: new Set([LIVE, CHROMA_ONLY]),
    workspaceDocumentIds: new Set([LIVE]),
    checklistDocumentIds: new Map([[CHECKLIST_ONLY, 1]]),
    imageFolders: [],
    originals: fs
      .readdirSync(originals)
      .filter((name) => /^[a-f0-9]{64}\.pdf$/.test(name))
      .map((name) => ({
        storageKey: name.slice(0, 64),
        bytes: fs.statSync(path.join(originals, name)).size + 2,
      })),
    vectorCounts: { body: 1, image: 0 },
    // what the real loader collects: workspace, search data, checklists,
    // image folders, quizzes and the sources saved with past answers
    knownDocumentIds: complete
      ? new Set([LIVE, CHROMA_ONLY, CHECKLIST_ONLY, CHAT_ONLY, QUIZ_ONLY])
      : null,
  });
  return { root, originals, loadInputs };
}

const originalGroup = (report, id) =>
  report.groups.find(
    (g) => g.kind === "original" && g.originalKey === originalStorageKey(id)
  );

test("only an original no document id points to is judged deletable", async () => {
  const { loadInputs } = setup();
  const report = classifyStorage(await loadInputs());
  assert.equal(originalGroup(report, ORPHAN_1).status, STATUS.UNLINKED);
  assert.equal(originalGroup(report, ORPHAN_2).status, STATUS.UNLINKED);
  for (const id of [CHAT_ONLY, QUIZ_ONLY, CHECKLIST_ONLY, CHROMA_ONLY])
    assert.equal(originalGroup(report, id).status, STATUS.REVIEW, id);
  // the workspace document's original belongs to its upload, never an orphan
  assert.equal(originalGroup(report, LIVE), undefined);
  const live = report.groups.find((g) => g.kind === "upload");
  assert.equal(live.status, STATUS.IN_USE);
  assert.equal(live.original.inUse, true);
});

test("an incomplete reference scan never marks an original deletable", async () => {
  const { loadInputs } = setup();
  const report = classifyStorage(await loadInputs({ complete: false }));
  for (const group of report.groups.filter((g) => g.kind === "original"))
    assert.equal(group.status, STATUS.REVIEW);
});

test("browser payloads never contain the original file key or document ids", async () => {
  const { loadInputs } = setup();
  const json = JSON.stringify(
    publicReport(classifyStorage(await loadInputs()))
  );
  assert.equal(json.includes(originalStorageKey(ORPHAN_1)), false);
  assert.equal(json.includes(ORPHAN_1), false);
});

test("the old-upload preview never takes original PDFs", async () => {
  const { loadInputs } = setup();
  const report = classifyStorage(await loadInputs());
  const preview = buildCleanupPreview(report, [
    originalGroup(report, ORPHAN_1).key,
  ]);
  assert.equal(preview.ok, false);
  assert.match(preview.blocked[0].reason, /원본 PDF/);
});

test("deletes selected unused originals and refuses the rest one by one", async () => {
  const { root, originals, loadInputs } = setup();
  const report = classifyStorage(await loadInputs());
  const keyOf = (id) => originalGroup(report, id).key;
  const liveUpload = report.groups.find((g) => g.kind === "upload").key;
  const result = await executeOriginalPdfCleanup(
    [
      keyOf(ORPHAN_1),
      keyOf(ORPHAN_2),
      keyOf(CHAT_ONLY),
      keyOf(QUIZ_ONLY),
      keyOf(CHECKLIST_ONLY),
      keyOf(CHROMA_ONLY),
      liveUpload,
      "unknown-key",
    ],
    { loadInputs, root }
  );

  assert.equal(result.deleted, 2);
  assert.equal(result.refused, 6);
  assert.equal(result.ok, false); // not every selection was deleted
  assert.deepEqual(result.changed, []);
  assert.ok(result.freedBytes > 0);
  const byKey = new Map(result.results.map((r) => [r.key, r]));
  assert.equal(byKey.get(keyOf(ORPHAN_1)).deleted, true);
  assert.equal(byKey.get(keyOf(ORPHAN_2)).deleted, true);
  for (const id of [CHAT_ONLY, QUIZ_ONLY, CHECKLIST_ONLY, CHROMA_ONLY]) {
    assert.equal(byKey.get(keyOf(id)).deleted, false, id);
    assert.match(byKey.get(keyOf(id)).reason, /확인이 필요/);
  }
  assert.match(byKey.get(liveUpload).reason, /원본 PDF 항목이 아닙니다/);
  assert.match(byKey.get("unknown-key").reason, /찾을 수 없습니다/);

  // files: only the two orphan originals (pdf + metadata) are gone
  const exists = (id, ext) =>
    fs.existsSync(path.join(originals, `${originalStorageKey(id)}.${ext}`));
  for (const id of [ORPHAN_1, ORPHAN_2]) {
    assert.equal(exists(id, "pdf"), false);
    assert.equal(exists(id, "json"), false);
  }
  for (const id of [LIVE, CHAT_ONLY, QUIZ_ONLY, CHECKLIST_ONLY, CHROMA_ONLY])
    assert.equal(exists(id, "pdf"), true, id);
  assert.equal(fs.existsSync(path.join(root, "anythingllm.db")), true);

  // list: the deleted originals are no longer reported
  const after = classifyStorage(await loadInputs());
  assert.equal(originalGroup(after, ORPHAN_1), undefined);
  assert.equal(originalGroup(after, ORPHAN_2), undefined);
  assert.deepEqual(result.before, result.after);
});

test("several unused originals are deleted together with full success", async () => {
  const { root, loadInputs } = setup();
  const report = classifyStorage(await loadInputs());
  const result = await executeOriginalPdfCleanup(
    [originalGroup(report, ORPHAN_1).key, originalGroup(report, ORPHAN_2).key],
    { loadInputs, root }
  );
  assert.equal(result.ok, true);
  assert.equal(result.deleted, 2);
  assert.equal(result.refused, 0);
});

test("a file that became referenced after the list was shown is not deleted", async () => {
  const { root, originals, loadInputs } = setup();
  const report = classifyStorage(await loadInputs());
  const key = originalGroup(report, ORPHAN_1).key;
  // e.g. an answer now cites this document: the fresh scan knows the id
  const result = await executeOriginalPdfCleanup([key], {
    root,
    loadInputs: async () => {
      const inputs = await loadInputs();
      inputs.knownDocumentIds.add(ORPHAN_1);
      return inputs;
    },
  });
  assert.equal(result.deleted, 0);
  assert.equal(
    fs.existsSync(path.join(originals, `${originalStorageKey(ORPHAN_1)}.pdf`)),
    true
  );
});

test("original PDF delete endpoint is admin only and needs confirmation", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "../../../endpoints/schatAdmin.js"),
    "utf8"
  );
  const block = source.slice(
    source.indexOf('"/schat-admin/storage-cleanup/originals/delete"'),
    source.indexOf("// 사용 통계")
  );
  assert.match(block, /flexUserRoleValid\(\[ROLES\.admin\]\)/);
  assert.match(block, /confirm !== true/);
  assert.match(block, /cleanupRunning/);
  assert.match(block, /executeOriginalPdfCleanup/);
  assert.match(block, /schat_original_pdf_cleanup/);
});
