// "저장공간 정리" (storage cleanup).
// Groups stored page records, PDF image folders and original PDFs by upload
// (document_id), decides what is still used by the live workspace, builds a
// deletion preview and - only through executeStorageCleanup - deletes files of
// old uploads after a fresh re-scan. Vectors, database rows and the image
// description cache are never touched here.
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const STATUS = {
  IN_USE: "in_use", // 현재 사용 중 - protected
  OLD_UPLOAD: "old_upload", // 예전 업로드 - deletable
  UNLINKED: "unlinked", // 연결되지 않은 파일 - deletable
  REVIEW: "review", // 검토 필요 - not deletable
};
const DELETABLE = new Set([STATUS.OLD_UPLOAD, STATUS.UNLINKED]);

function storageRoot() {
  return process.env.NODE_ENV === "production" && process.env.STORAGE_DIR
    ? path.resolve(process.env.STORAGE_DIR)
    : path.resolve(__dirname, "../../storage");
}

// Opaque, stable key so the browser never sees document ids or paths.
function groupKey(kind, id) {
  return crypto
    .createHash("sha256")
    .update(`schat-storage-cleanup:${kind}:${id}`)
    .digest("hex")
    .slice(0, 20);
}

function originalStorageKey(documentId) {
  return crypto.createHash("sha256").update(String(documentId)).digest("hex");
}

function topFolder(relativePath = "") {
  const first = String(relativePath).replace(/\\/g, "/").split("/")[0];
  return first && first !== "." && first !== ".." ? first : null;
}

const EMPTY_USAGE = {
  workspacePages: 0,
  vectorPages: 0,
  chromaReferenced: false,
  checklists: 0,
  imagesReferenced: false,
  pdfViewerReferenced: false,
  imageDescriptionVectors: 0,
  relatedImagesReferenced: false,
};
const NO_PAGE_FILES = {
  pageFiles: [],
  auxiliaryFiles: 0,
  auxiliaryBytes: 0,
  cacheFileNames: [],
};

// Any single signal means "현재 사용 중".
function isInUse(usage) {
  return (
    usage.workspacePages > 0 ||
    usage.vectorPages > 0 ||
    usage.chromaReferenced ||
    usage.checklists > 0 ||
    usage.imagesReferenced ||
    usage.pdfViewerReferenced ||
    usage.imageDescriptionVectors > 0 ||
    usage.relatedImagesReferenced
  );
}

/**
 * Pure classification. Every "in use" signal protects a group; a group is only
 * deletable when all signals are absent.
 * @param {object} input
 * @param {Array<{fileName, documentId, title, page, published, bytes}>} input.pageRecords
 * @param {Array<{docpath, docId, imageFolders: string[], documentId?}>} input.workspaceDocs
 * @param {Set<string>} input.vectorDocIds workspace doc ids with vector rows
 * @param {Set<string>} input.chromaDocumentIds document_ids found in Chroma metadata
 * @param {Set<string>} input.workspaceDocumentIds document_ids of live workspace
 *   documents (the PDF viewer and Citation only resolve these)
 * @param {Map<string, number>} input.imageVectorsByDocument image_description
 *   vectors per document_id
 * @param {Set<string>} input.relatedImageFolders image folders that serve an
 *   image key referenced by a vector (relatedImages)
 * @param {Map<string, number>} input.checklistDocumentIds
 * @param {Array<{name, files, bytes}>} input.imageFolders non-hidden folders
 * @param {Array<{storageKey, bytes}>} input.originals original PDFs (+metadata)
 * @param {{files, bytes}} input.descriptionCache kept, never a candidate
 * @param {{body, image}} input.vectorCounts
 */
function classifyStorage(input) {
  const {
    pageRecords = [],
    workspaceDocs = [],
    vectorDocIds = new Set(),
    chromaDocumentIds = new Set(),
    workspaceDocumentIds = new Set(),
    imageVectorsByDocument = new Map(),
    relatedImageFolders = new Set(),
    checklistDocumentIds = new Map(),
    imageFolders = [],
    originals = [],
    descriptionCache = { files: 0, bytes: 0 },
    vectorCounts = { body: 0, image: 0 },
  } = input;

  const workspaceByDocpath = new Map(
    workspaceDocs.map((doc) => [doc.docpath, doc])
  );
  const liveImageFolders = new Set(
    workspaceDocs.flatMap((doc) => doc.imageFolders || [])
  );
  const imageFolderByName = new Map(imageFolders.map((f) => [f.name, f]));
  const originalByKey = new Map(originals.map((o) => [o.storageKey, o]));
  const claimedImageFolders = new Set();
  const claimedOriginals = new Set();

  const byDocument = new Map();
  const unreadable = [];
  for (const record of pageRecords) {
    if (!record.documentId) {
      unreadable.push(record);
      continue;
    }
    if (!byDocument.has(record.documentId))
      byDocument.set(record.documentId, []);
    byDocument.get(record.documentId).push(record);
  }

  const groups = [];
  for (const [documentId, records] of byDocument) {
    const livePages = records.filter((r) =>
      workspaceByDocpath.has(`custom-documents/${r.fileName}`)
    );
    const vectorPages = livePages.filter((r) =>
      vectorDocIds.has(
        workspaceByDocpath.get(`custom-documents/${r.fileName}`).docId
      )
    ).length;
    const image = imageFolderByName.get(documentId) || null;
    if (image) claimedImageFolders.add(documentId);
    const original = originalByKey.get(originalStorageKey(documentId)) || null;
    if (original) claimedOriginals.add(original.storageKey);
    const titles = [...new Set(records.map((r) => r.title).filter(Boolean))];
    // "published" is often "unknown", so the file time is the fallback.
    const published = records
      .map((r) => {
        const parsed = Date.parse(r.published);
        return Number.isFinite(parsed) ? parsed : Date.parse(r.modifiedAt);
      })
      .filter(Number.isFinite)
      .sort((a, b) => a - b)[0];

    const usage = {
      workspacePages: livePages.length,
      vectorPages,
      chromaReferenced: chromaDocumentIds.has(documentId),
      checklists: checklistDocumentIds.get(documentId) || 0,
      imagesReferenced: liveImageFolders.has(documentId),
      pdfViewerReferenced: workspaceDocumentIds.has(documentId),
      imageDescriptionVectors: imageVectorsByDocument.get(documentId) || 0,
      relatedImagesReferenced: relatedImageFolders.has(documentId),
    };
    const inUse = isInUse(usage);
    const cacheFiles = records.flatMap((r) => r.cacheFiles || []);
    const reasons = [];
    let status = inUse ? STATUS.IN_USE : STATUS.OLD_UPLOAD;
    if (!inUse && titles.length !== 1) {
      status = STATUS.REVIEW;
      reasons.push("한 업로드에 문서 이름이 여러 개입니다.");
    }

    groups.push({
      key: groupKey("document", documentId),
      documentId, // internal only; stripped before sending to the browser
      kind: "upload",
      title: titles[0] || "이름 없는 문서",
      uploadedAt: Number.isFinite(published)
        ? new Date(published).toISOString()
        : null,
      pages: new Set(records.map((r) => r.page)).size,
      pageRecords: records.length,
      pageRecordBytes: records.reduce((sum, r) => sum + (r.bytes || 0), 0),
      pageFiles: records.map((r) => r.fileName), // internal only
      auxiliaryFiles: cacheFiles.length,
      auxiliaryBytes: cacheFiles.reduce((sum, c) => sum + (c.bytes || 0), 0),
      cacheFileNames: cacheFiles.map((c) => c.name), // internal only
      imageFiles: image?.files || 0,
      imageBytes: image?.bytes || 0,
      original: original
        ? { exists: true, bytes: original.bytes, inUse: inUse }
        : { exists: false, bytes: 0, inUse: false },
      usage,
      status,
      reasons,
    });
  }

  // Image folders with no page records at all.
  for (const folder of imageFolders) {
    if (claimedImageFolders.has(folder.name)) continue;
    const folderUsage = {
      workspacePages: 0,
      vectorPages: 0,
      chromaReferenced: chromaDocumentIds.has(folder.name),
      checklists: checklistDocumentIds.get(folder.name) || 0,
      imagesReferenced: liveImageFolders.has(folder.name),
      pdfViewerReferenced: workspaceDocumentIds.has(folder.name),
      imageDescriptionVectors: imageVectorsByDocument.get(folder.name) || 0,
      relatedImagesReferenced: relatedImageFolders.has(folder.name),
    };
    const referenced = isInUse(folderUsage);
    groups.push({
      key: groupKey("image-folder", folder.name),
      documentId: folder.name,
      kind: "image_folder",
      title: "연결되지 않은 이미지 폴더",
      uploadedAt: folder.modifiedAt || null,
      pages: 0,
      pageRecords: 0,
      pageRecordBytes: 0,
      ...NO_PAGE_FILES,
      imageFiles: folder.files,
      imageBytes: folder.bytes,
      original: { exists: false, bytes: 0, inUse: false },
      usage: folderUsage,
      status: referenced ? STATUS.IN_USE : STATUS.UNLINKED,
      reasons: [],
    });
  }

  // Original PDFs whose upload is unknown: the source file itself, so never
  // offered for deletion automatically.
  for (const original of originals) {
    if (claimedOriginals.has(original.storageKey)) continue;
    groups.push({
      key: groupKey("original", original.storageKey),
      documentId: null,
      kind: "original",
      title: "연결 정보가 없는 원본 PDF",
      uploadedAt: original.modifiedAt || null,
      pages: 0,
      pageRecords: 0,
      pageRecordBytes: 0,
      ...NO_PAGE_FILES,
      imageFiles: 0,
      imageBytes: 0,
      original: { exists: true, bytes: original.bytes, inUse: false },
      usage: { ...EMPTY_USAGE },
      status: STATUS.REVIEW,
      reasons: ["어느 업로드의 원본인지 확인할 수 없습니다."],
    });
  }

  if (unreadable.length)
    groups.push({
      key: groupKey("unreadable", unreadable.map((r) => r.fileName).join("|")),
      documentId: null,
      kind: "unreadable",
      title: "읽을 수 없는 페이지 기록",
      uploadedAt: null,
      pages: 0,
      pageRecords: unreadable.length,
      pageRecordBytes: unreadable.reduce((s, r) => s + (r.bytes || 0), 0),
      ...NO_PAGE_FILES,
      imageFiles: 0,
      imageBytes: 0,
      original: { exists: false, bytes: 0, inUse: false },
      usage: { ...EMPTY_USAGE },
      status: STATUS.REVIEW,
      reasons: ["문서 정보를 읽을 수 없습니다."],
    });

  const order = { in_use: 0, old_upload: 1, unlinked: 2, review: 3 };
  groups.sort(
    (a, b) =>
      order[a.status] - order[b.status] ||
      a.title.localeCompare(b.title, "ko") ||
      String(a.uploadedAt).localeCompare(String(b.uploadedAt))
  );

  const inUse = groups.filter((g) => g.status === STATUS.IN_USE);
  const deletable = groups.filter((g) => DELETABLE.has(g.status));
  return {
    groups,
    summary: {
      current: {
        documents: inUse.filter((g) => g.usage.workspacePages > 0).length,
        pages: inUse.reduce((s, g) => s + g.usage.workspacePages, 0),
        bodyVectors: vectorCounts.body,
        imageVectors: vectorCounts.image,
        checklists: [...checklistDocumentIds.values()].reduce(
          (s, n) => s + n,
          0
        ),
        originals: inUse.filter((g) => g.original.exists).length,
      },
      cleanup: {
        oldUploads: deletable.filter((g) => g.kind === "upload").length,
        unlinked: deletable.filter((g) => g.kind !== "upload").length,
        pageRecords: deletable.reduce((s, g) => s + g.pageRecords, 0),
        imageBytes: deletable.reduce((s, g) => s + g.imageBytes, 0),
        totalBytes: deletable.reduce((s, g) => s + groupBytes(g), 0),
      },
      review: groups.filter((g) => g.status === STATUS.REVIEW).length,
      descriptionCache,
    },
  };
}

function groupBytes(group) {
  return (
    group.pageRecordBytes +
    (group.auxiliaryBytes || 0) +
    group.imageBytes +
    group.original.bytes
  );
}

/**
 * Deletion preview (삭제 전 미리보기). Re-validates every selected key against
 * a fresh classification: anything missing, protected or needing review blocks
 * the whole preview.
 */
function buildCleanupPreview(report, keys = []) {
  const byKey = new Map(report.groups.map((g) => [g.key, g]));
  const selected = [];
  const blocked = [];
  for (const key of [...new Set(keys)]) {
    const group = byKey.get(key);
    if (!group) {
      blocked.push({
        key,
        reason: "항목을 찾을 수 없습니다. 목록을 새로 고쳐 주세요.",
      });
      continue;
    }
    if (
      group.usage.vectorPages > 0 ||
      group.usage.chromaReferenced ||
      group.usage.imageDescriptionVectors > 0
    ) {
      blocked.push({
        key,
        title: group.title,
        reason: "현재 검색 데이터와 연결되어 있어 삭제할 수 없습니다.",
      });
      continue;
    }
    if (!DELETABLE.has(group.status)) {
      blocked.push({
        key,
        title: group.title,
        reason:
          group.status === STATUS.IN_USE
            ? "현재 사용 중이라 삭제할 수 없습니다."
            : "검토가 필요한 항목이라 삭제할 수 없습니다.",
      });
      continue;
    }
    selected.push(group);
  }
  const sum = (fn) => selected.reduce((s, g) => s + fn(g), 0);
  return {
    ok: selected.length > 0 && blocked.length === 0,
    blocked,
    remove: {
      items: selected.map(publicGroup),
      pageRecords: sum((g) => g.pageRecords),
      auxiliaryFiles: sum((g) => g.auxiliaryFiles || 0),
      imageFolders: selected.filter((g) => g.imageFiles > 0).length,
      imageFiles: sum((g) => g.imageFiles),
      originals: selected.filter((g) => g.original.exists).length,
      bytes: sum(groupBytes),
    },
    keep: {
      ...report.summary.current,
      descriptionCache: report.summary.descriptionCache,
    },
  };
}

/**
 * Manifest recorded next to every deletion (storage/schat-diagnostics).
 * Internal ids are kept here because this file stays on the server.
 */
function buildCleanupManifest(
  report,
  keys,
  { adminUsername, at = new Date() }
) {
  const byKey = new Map(report.groups.map((g) => [g.key, g]));
  return {
    schema: "schat-storage-cleanup-manifest/1",
    fileName: `cleanup-manifest-${at.toISOString().slice(0, 10)}.json`,
    createdAt: at.toISOString(),
    admin: adminUsername || null,
    items: keys
      .map((key) => byKey.get(key))
      .filter(Boolean)
      .map((g) => ({
        title: g.title,
        kind: g.kind,
        documentId: g.documentId,
        pages: g.pages,
        pageRecords: g.pageRecords,
        auxiliaryFiles: g.auxiliaryFiles || 0,
        imageFolder: g.imageFiles > 0 ? g.documentId : null,
        imageFiles: g.imageFiles,
        bytes: groupBytes(g),
        originalPdf: g.original.exists,
      })),
    before: report.summary.current,
    after: null,
    verified: false,
  };
}

// Fields that must be identical before and after a deletion.
const PROTECTED_FIELDS = [
  "documents",
  "pages",
  "bodyVectors",
  "imageVectors",
  "checklists",
  "originals",
];
function compareOperationalSnapshots(before = {}, after = {}) {
  const changed = PROTECTED_FIELDS.filter((f) => before[f] !== after[f]).map(
    (field) => ({ field, before: before[field], after: after[field] })
  );
  return { ok: changed.length === 0, changed };
}

// ---- deletion ---------------------------------------------------------------

const SAFE_DOCUMENT_ID = /^[A-Za-z0-9][A-Za-z0-9-]{7,}$/;
const SAFE_PAGE_FILE = /^[^/\\]+\.json$/;
const SAFE_CACHE_FILE = /^[a-f0-9-]{36}\.json$/;

function isInside(dir, target) {
  const relative = path.relative(dir, target);
  return (
    Boolean(relative) &&
    !relative.startsWith("..") &&
    !path.isAbsolute(relative) &&
    !relative.includes(path.sep)
  );
}

/**
 * Every file/folder a deletion may remove, resolved from the internal group
 * data. Throws on anything protected or unexpected instead of skipping it.
 */
function deletionTargets(groups, root) {
  const dirs = {
    pages: path.join(root, "documents", "custom-documents"),
    cache: path.join(root, "vector-cache"),
    images: path.join(root, "document-images"),
    originals: path.join(root, "original-documents"),
  };
  const files = [];
  const folders = [];
  const add = (list, dir, name) => {
    const target = path.join(dir, name);
    if (!isInside(dir, target)) throw new Error("unsafe cleanup path");
    list.push(target);
  };
  for (const group of groups) {
    if (!DELETABLE.has(group.status) || isInUse(group.usage))
      throw new Error("protected cleanup group");
    for (const name of group.pageFiles || []) {
      if (!SAFE_PAGE_FILE.test(name)) throw new Error("unsafe page file");
      add(files, dirs.pages, name);
    }
    for (const name of group.cacheFileNames || []) {
      if (!SAFE_CACHE_FILE.test(name)) throw new Error("unsafe cache file");
      add(files, dirs.cache, name);
    }
    if (!group.documentId || !SAFE_DOCUMENT_ID.test(group.documentId))
      throw new Error("unsafe document id");
    // .description-cache starts with "." and never matches SAFE_DOCUMENT_ID.
    if (fs.existsSync(path.join(dirs.images, group.documentId)))
      add(folders, dirs.images, group.documentId);
    if (group.original.exists) {
      const storageKey = originalStorageKey(group.documentId);
      add(files, dirs.originals, `${storageKey}.pdf`);
      add(files, dirs.originals, `${storageKey}.json`);
    }
  }
  return { files, folders };
}

function removeTargets({ files, folders }) {
  let removed = 0;
  let bytes = 0;
  const failed = [];
  for (const file of files) {
    try {
      const stat = fs.lstatSync(file, { throwIfNoEntry: false });
      if (!stat) continue;
      if (!stat.isFile()) throw new Error("not a file");
      fs.rmSync(file);
      removed += 1;
      bytes += stat.size;
    } catch (error) {
      failed.push(error.code || error.message);
    }
  }
  for (const folder of folders) {
    try {
      const stat = fs.lstatSync(folder, { throwIfNoEntry: false });
      if (!stat) continue;
      if (!stat.isDirectory() || stat.isSymbolicLink())
        throw new Error("not a folder");
      const size = folderStats(folder);
      fs.rmSync(folder, { recursive: true });
      removed += size.files;
      bytes += size.bytes;
    } catch (error) {
      failed.push(error.code || error.message);
    }
  }
  return { removed, bytes, failed };
}

/**
 * 실제 삭제. Re-scans current data, re-validates the selection (the browser's
 * "삭제 가능" label is not trusted), deletes only files of old uploads, then
 * re-scans and requires the operational snapshot to be unchanged.
 */
async function executeStorageCleanup(
  keys = [],
  {
    actorId = null,
    loadInputs = loadStorageCleanupInputs,
    root = storageRoot(),
    at = new Date(),
  } = {}
) {
  const before = classifyStorage(await loadInputs());
  const preview = buildCleanupPreview(before, keys);
  if (!preview.ok) return { ok: false, stage: "verify", preview };

  const byKey = new Map(before.groups.map((g) => [g.key, g]));
  const selected = [...new Set(keys)].map((key) => byKey.get(key));
  const live = new Set(
    before.groups
      .filter((g) => g.status === STATUS.IN_USE && g.documentId)
      .map((g) => g.documentId)
  );
  if (selected.some((g) => live.has(g.documentId)))
    return { ok: false, stage: "verify", preview };

  const targets = deletionTargets(selected, root);
  const manifest = buildCleanupManifest(before, keys, {
    adminUsername: actorId ? `user:${actorId}` : null,
    at,
  });
  const result = removeTargets(targets);

  const after = classifyStorage(await loadInputs());
  const comparison = compareOperationalSnapshots(
    before.summary.current,
    after.summary.current
  );
  const remaining = selected.filter((g) =>
    after.groups.some((a) => a.key === g.key)
  ).length;
  const ok = comparison.ok && remaining === 0 && result.failed.length === 0;

  manifest.after = after.summary.current;
  manifest.removedFiles = result.removed;
  manifest.freedBytes = result.bytes;
  manifest.failed = result.failed.length;
  manifest.verified = ok;
  try {
    const dir = path.join(root, "schat-diagnostics", "storage-cleanup");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(
        dir,
        manifest.fileName.replace(/\.json$/, `-${at.getTime()}.json`)
      ),
      JSON.stringify(manifest, null, 2),
      { mode: 0o600 }
    );
  } catch {}

  return {
    ok,
    stage: "done",
    removed: preview.remove,
    removedFiles: result.removed,
    freedBytes: result.bytes,
    failed: result.failed.length,
    remaining,
    before: before.summary.current,
    after: after.summary.current,
    changed: comparison.changed,
    report: after,
  };
}

function publicGroup(group) {
  const {
    documentId: _hidden,
    pageFiles: _pages,
    cacheFileNames: _cache,
    ...rest
  } = group;
  return { ...rest, totalBytes: groupBytes(group) };
}

function publicReport(report) {
  return { summary: report.summary, groups: report.groups.map(publicGroup) };
}

// ---- data loading (read only) -------------------------------------------

function folderStats(dir) {
  let files = 0;
  let bytes = 0;
  const walk = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) {
        files += 1;
        bytes += fs.statSync(full).size;
      }
    }
  };
  if (fs.existsSync(dir)) walk(dir);
  return { files, bytes };
}

// Vector-cache files are named uuidv5(cacheKey); the key is the page docpath,
// with the chunk policy version appended since the SCHAT Chroma pilot.
const LEGACY_CHUNK_POLICIES = ["schat-chroma-900-120-v1"];
function vectorCacheNames(docpath) {
  const { v5: uuidv5 } = require("uuid");
  const {
    SCHAT_CHUNK_POLICY_VERSION,
  } = require("../vectorDbProviders/chroma/schatPolicy");
  const keys = [
    docpath,
    ...new Set([SCHAT_CHUNK_POLICY_VERSION, ...LEGACY_CHUNK_POLICIES]),
  ].map((key, i) => (i === 0 ? key : `${docpath}::${key}`));
  return keys.map((key) => `${uuidv5(key, uuidv5.URL)}.json`);
}

function readPageRecords(documentsDir, cacheDir = null) {
  const dir = path.join(documentsDir, "custom-documents");
  if (!fs.existsSync(dir)) return [];
  const cached = new Set(
    cacheDir && fs.existsSync(cacheDir) ? fs.readdirSync(cacheDir) : []
  );
  return fs
    .readdirSync(dir)
    .filter((name) => name.endsWith(".json"))
    .map((fileName) => {
      const full = path.join(dir, fileName);
      const stat = fs.statSync(full);
      const bytes = stat.size;
      const modifiedAt = stat.mtime.toISOString();
      const cacheFiles = vectorCacheNames(`custom-documents/${fileName}`)
        .filter((name) => cached.has(name))
        .map((name) => ({
          name,
          bytes: fs.statSync(path.join(cacheDir, name)).size,
        }));
      try {
        const data = JSON.parse(fs.readFileSync(full, "utf8"));
        return {
          fileName,
          documentId: data.document_id || null,
          title: data.title || null,
          page: data.page ?? null,
          published: data.published || null,
          modifiedAt,
          bytes,
          cacheFiles,
        };
      } catch {
        return { fileName, documentId: null, bytes, modifiedAt };
      }
    });
}

async function loadStorageCleanupInputs() {
  const prisma = require("../prisma");
  const { getVectorDbClass } = require("../helpers");
  const { ChecklistRepository } = require("../documentChecklists/repository");
  const root = storageRoot();

  const rows = await prisma.workspace_documents.findMany({
    select: { docpath: true, docId: true, metadata: true },
  });
  const workspaceDocumentIds = new Set();
  const imageFolderByKey = new Map();
  const workspaceDocs = rows.map((row) => {
    let metadata = {};
    try {
      metadata = JSON.parse(row.metadata || "{}");
    } catch {}
    for (const image of metadata.pdf_images || []) {
      const folder = topFolder(image?.storage_relative_path);
      if (image?.image_key && folder)
        imageFolderByKey.set(image.image_key, folder);
    }
    if (metadata.document_id)
      workspaceDocumentIds.add(String(metadata.document_id).trim());
    return {
      docpath: row.docpath,
      docId: row.docId,
      imageFolders: [
        ...new Set(
          (metadata.pdf_images || [])
            .map((image) => topFolder(image?.storage_relative_path))
            .filter(Boolean)
        ),
      ],
    };
  });
  const vectorRows = await prisma.document_vectors.findMany({
    select: { docId: true },
    distinct: ["docId"],
  });

  // Chroma metadata is read, never written.
  const chromaDocumentIds = new Set();
  const imageVectorsByDocument = new Map();
  const referencedImageKeys = new Set();
  const vectorCounts = { body: 0, image: 0 };
  const VectorDb = getVectorDbClass();
  const workspaces = await prisma.workspaces.findMany({
    select: { slug: true },
  });
  if (typeof VectorDb.connect === "function") {
    const { client } = await VectorDb.connect();
    for (const { slug } of workspaces) {
      const collection = await client
        .getCollection({
          name: VectorDb.normalize ? VectorDb.normalize(slug) : slug,
        })
        .catch(() => null);
      if (!collection) continue;
      const total = await collection.count();
      for (let offset = 0; offset < total; offset += 500) {
        const page = await collection.get({
          limit: 500,
          offset,
          include: ["metadatas"],
        });
        for (const metadata of page.metadatas || []) {
          if (metadata?.document_id)
            chromaDocumentIds.add(metadata.document_id);
          if (metadata?.image_key) referencedImageKeys.add(metadata.image_key);
          try {
            for (const key of JSON.parse(metadata?.related_image_keys || "[]"))
              referencedImageKeys.add(key);
          } catch {}
          if (metadata?.content_type === "image_description") {
            vectorCounts.image += 1;
            if (metadata?.document_id)
              imageVectorsByDocument.set(
                metadata.document_id,
                (imageVectorsByDocument.get(metadata.document_id) || 0) + 1
              );
          } else vectorCounts.body += 1;
        }
      }
    }
  }

  const checklistDocumentIds = new Map();
  for (const checklist of ChecklistRepository.listAll()) {
    if (!checklist?.documentId) continue;
    checklistDocumentIds.set(
      checklist.documentId,
      (checklistDocumentIds.get(checklist.documentId) || 0) + 1
    );
  }

  const imagesDir = path.join(root, "document-images");
  const imageFolders = fs.existsSync(imagesDir)
    ? fs
        .readdirSync(imagesDir, { withFileTypes: true })
        .filter((e) => e.isDirectory() && !e.name.startsWith("."))
        .map((e) => {
          const full = path.join(imagesDir, e.name);
          return {
            name: e.name,
            ...folderStats(full),
            modifiedAt: fs.statSync(full).mtime.toISOString(),
          };
        })
    : [];

  const originalsDir = path.join(root, "original-documents");
  const originals = fs.existsSync(originalsDir)
    ? fs
        .readdirSync(originalsDir)
        .filter((name) => /^[a-f0-9]{64}\.pdf$/.test(name))
        .map((name) => {
          const storageKey = name.slice(0, 64);
          const pdf = path.join(originalsDir, name);
          const meta = path.join(originalsDir, `${storageKey}.json`);
          return {
            storageKey,
            bytes:
              fs.statSync(pdf).size +
              (fs.existsSync(meta) ? fs.statSync(meta).size : 0),
            modifiedAt: fs.statSync(pdf).mtime.toISOString(),
          };
        })
    : [];

  // relatedImages resolve an image key through live workspace metadata only.
  const relatedImageFolders = new Set(
    [...referencedImageKeys]
      .map((key) => imageFolderByKey.get(key))
      .filter(Boolean)
  );

  return {
    pageRecords: readPageRecords(
      path.join(root, "documents"),
      path.join(root, "vector-cache")
    ),
    workspaceDocs,
    vectorDocIds: new Set(vectorRows.map((r) => r.docId)),
    chromaDocumentIds,
    workspaceDocumentIds,
    imageVectorsByDocument,
    relatedImageFolders,
    checklistDocumentIds,
    imageFolders,
    originals,
    descriptionCache: folderStats(path.join(imagesDir, ".description-cache")),
    vectorCounts,
  };
}

module.exports = {
  STATUS,
  classifyStorage,
  buildCleanupPreview,
  buildCleanupManifest,
  compareOperationalSnapshots,
  executeStorageCleanup,
  deletionTargets,
  publicReport,
  loadStorageCleanupInputs,
  originalStorageKey,
  vectorCacheNames,
};
