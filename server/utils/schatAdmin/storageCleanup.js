// "저장공간 정리" (storage cleanup).
// Groups stored page records, PDF image folders and original PDFs by upload
// (document_id), decides what is still used by the live workspace, builds a
// deletion preview and - only through executeStorageCleanup - deletes files of
// old uploads after a fresh re-scan. Vectors, database rows and the image
// description cache are never touched here.
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const {collectOriginalReferences,emptyOriginalReferences} = require('./originalReferenceReview');

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
// 문서 등록 창(documentLibrary)과 같은 이름 기준: 경로를 떼고 NFC로 맞춤.
function legacyTitle(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  return value.replace(/\\/g, "/").split("/").pop().normalize("NFC");
}

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
    knownDocumentIds = null,
    originalReferences = null,
    checklistFilesByDocument = null,
    liveDocumentIds = null,
  } = input;
  // 실제 운영 자료를 읽을 때는 항상 연결 확인 결과가 들어옴(없으면 null).
  const checksReferences = Object.prototype.hasOwnProperty.call(
    input,
    "originalReferences"
  );
  // Original PDFs are stored as sha256(document_id). Every document id still
  // mentioned anywhere (pages, workspace, search data, checklists, images,
  // chats, quizzes) is hashed the same way; an original matching none of them
  // is unused. Without a complete scan nothing is judged unused.
  const referencedOriginalKeys =
    knownDocumentIds instanceof Set
      ? new Set(
          [...knownDocumentIds, ...pageRecords.map((r) => r.documentId)]
            .filter(Boolean)
            .map((id) => originalStorageKey(String(id).trim()))
        )
      : null;

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
  // 예전 형식 파일(문서 번호 없이 이름만 있는 Excel 시트 등)은 문서 등록 창과
  // 같은 기준(이름)으로 묶어 점검함. 내용을 읽을 수 없는 파일만 "확인 필요".
  const legacyByTitle = new Map();
  for (const record of pageRecords) {
    if (!record.documentId) {
      const title = legacyTitle(record.title);
      if (!title) {
        unreadable.push(record);
        continue;
      }
      if (!legacyByTitle.has(title)) legacyByTitle.set(title, []);
      legacyByTitle.get(title).push(record);
      continue;
    }
    if (!byDocument.has(record.documentId))
      byDocument.set(record.documentId, []);
    byDocument.get(record.documentId).push(record);
  }

  const groups = [];
  for (const [documentId, records] of byDocument) {
    const livePages = records.filter((r) =>
      workspaceByDocpath.has(r.docpath || `custom-documents/${r.fileName}`)
    );
    const vectorPages = livePages.filter((r) =>
      vectorDocIds.has(
        workspaceByDocpath.get(r.docpath || `custom-documents/${r.fileName}`).docId
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
    // 등록·검색·이미지·원본 보기 어디에도 안 쓰이고 체크리스트만 남은 업로드:
    // 그 체크리스트는 직원·관리자 화면에 나오지 않으므로(등록된 문서만 표시)
    // 사용 중으로 보지 않고, 삭제할 때 함께 지움(파일 목록을 알 때만).
    let orphanChecklists = 0;
    let checklistFiles = [];
    if (
      usage.checklists > 0 &&
      checklistFilesByDocument instanceof Map &&
      !isInUse({ ...usage, checklists: 0 })
    ) {
      orphanChecklists = usage.checklists;
      checklistFiles = checklistFilesByDocument.get(documentId) || [];
      usage.checklists = 0;
    }
    const inUse = isInUse(usage);
    const cacheFiles = records.flatMap((r) => r.cacheFiles || []);
    const reasons = [];
    let status = inUse ? STATUS.IN_USE : STATUS.OLD_UPLOAD;
    if (!inUse && titles.length !== 1) {
      status = STATUS.REVIEW;
      reasons.push("한 업로드에 문서 이름이 여러 개입니다.");
    }
    // 현재 퀴즈 문제가 이 문서를 근거로 하면 지우지 않음(문제를 지운 뒤 남는
    // 생성 기록·빈 퀴즈 세트는 막지 않음). 과거 답변의 출처로만 쓰였으면
    // 지울 수 있지만, 관리자에게 몇 건인지 알려 주고 한 번 더 확인받음.
    // 연결 확인 결과(originalReferences)를 받았는데 확인에 실패했으면 지우지 않음.
    let pastAnswerRefs = 0;
    if (!inUse && status === STATUS.OLD_UPLOAD && checksReferences) {
      const refs =
        originalReferences instanceof Map
          ? originalReferences.get(originalStorageKey(documentId))
          : undefined;
      if (!(originalReferences instanceof Map)) {
        status = STATUS.REVIEW;
        reasons.push("다른 자료와의 연결을 확인하지 못해 삭제하지 않습니다.");
      } else if (refs?.counts.quizQuestions > 0) {
        status = STATUS.REVIEW;
        reasons.push(
          `현재 퀴즈 ${refs.counts.quizQuestions}문항이 이 문서를 근거로 하고 있어 삭제하지 않습니다. 퀴즈를 먼저 정리해 주세요.`
        );
      } else if (refs?.counts.chats > 0) {
        pastAnswerRefs = refs.counts.chats;
      }
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
      pageFiles: records.filter((r) => !r.docpath).map((r) => r.fileName), // legacy fixtures
      pagePaths: records.filter((r) => r.docpath).map((r) => r.docpath), // internal only
      auxiliaryFiles: cacheFiles.length,
      auxiliaryBytes: cacheFiles.reduce((sum, c) => sum + (c.bytes || 0), 0),
      cacheFileNames: cacheFiles.map((c) => c.name), // internal only
      imageFiles: image?.files || 0,
      imageBytes: image?.bytes || 0,
      original: original
        ? { exists: true, bytes: original.bytes, inUse: inUse }
        : { exists: false, bytes: 0, inUse: false },
      usage,
      pastAnswerRefs,
      orphanChecklists,
      checklistFiles, // internal only
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

  // Original PDFs whose upload has no page records. Only an original that no
  // known document id points to is "연결되지 않은 파일"; anything else, or an
  // incomplete reference scan, stays "검토 필요".
  for (const original of originals) {
    if (claimedOriginals.has(original.storageKey)) continue;
    const scanned = referencedOriginalKeys !== null;
    const referenced =
      scanned && referencedOriginalKeys.has(original.storageKey);
    const unused = scanned && !referenced;
    groups.push({
      key: groupKey("original", original.storageKey),
      documentId: knownDocumentIds instanceof Set
        ? [...knownDocumentIds].find(id=>originalStorageKey(id)===original.storageKey) || null : null,
      originalKey: original.storageKey, // internal only
      originalName: original.originalName || null, // replacement lock scope, internal only
      references: scanned && originalReferences instanceof Map
        ? originalReferences.get(original.storageKey) || (unused ? emptyOriginalReferences() : null)
        : null,
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
      status: unused ? STATUS.UNLINKED : STATUS.REVIEW,
      reasons: unused
        ? [
            "작업 공간·페이지 기록·검색 데이터·체크리스트·대화 출처·퀴즈 어디에서도 쓰지 않는 원본입니다.",
          ]
        : referenced
          ? [
              "대화 기록·퀴즈 등 다른 자료에서 이 문서를 가리키고 있어 확인이 필요합니다.",
            ]
          : ["어느 업로드의 원본인지 확인할 수 없습니다."],
    });
  }

  for (const [title, records] of legacyByTitle) {
    const livePages = records.filter((r) =>
      workspaceByDocpath.has(r.docpath || `custom-documents/${r.fileName}`)
    );
    const vectorPages = livePages.filter((r) =>
      vectorDocIds.has(
        workspaceByDocpath.get(r.docpath || `custom-documents/${r.fileName}`).docId
      )
    ).length;
    const cacheFiles = records.flatMap((r) => r.cacheFiles || []);
    const published = records
      .map((r) => Date.parse(r.published) || Date.parse(r.modifiedAt))
      .filter(Number.isFinite)
      .sort((a, b) => a - b)[0];
    // 문서 번호가 없으면 검색 데이터·체크리스트·퀴즈·과거 답변 출처·원본이
    // 이 파일을 가리킬 수 없음. 등록돼 있을 때만 "현재 사용 중".
    const usage = {
      ...EMPTY_USAGE,
      workspacePages: livePages.length,
      vectorPages,
      pdfViewerReferenced: livePages.length > 0,
    };
    groups.push({
      key: groupKey("title", title),
      documentId: null,
      legacy: true,
      kind: "upload",
      title,
      uploadedAt: Number.isFinite(published)
        ? new Date(published).toISOString()
        : null,
      pages: records.length,
      pageRecords: records.length,
      pageRecordBytes: records.reduce((sum, r) => sum + (r.bytes || 0), 0),
      pageFiles: records.filter((r) => !r.docpath).map((r) => r.fileName),
      pagePaths: records.filter((r) => r.docpath).map((r) => r.docpath),
      auxiliaryFiles: cacheFiles.length,
      auxiliaryBytes: cacheFiles.reduce((sum, c) => sum + (c.bytes || 0), 0),
      cacheFileNames: cacheFiles.map((c) => c.name),
      imageFiles: 0,
      imageBytes: 0,
      original: { exists: false, bytes: 0, inUse: false },
      usage,
      pastAnswerRefs: 0,
      orphanChecklists: 0,
      checklistFiles: [],
      status: isInUse(usage) ? STATUS.IN_USE : STATUS.OLD_UPLOAD,
      reasons: [],
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
        // 현재 등록 문서(예전 버전 제외)의 체크리스트만 셈. 문서 번호 목록이
        // 없으면(예전 검사 자료) 전체를 셈.
        checklists: [...checklistDocumentIds.entries()]
          .filter(([id]) => !(liveDocumentIds instanceof Set) || liveDocumentIds.has(id))
          .reduce((sum, [, n]) => sum + n, 0),
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
    // Original PDFs have their own per-file deletion (executeOriginalPdfCleanup).
    if (group.kind === "original") {
      blocked.push({
        key,
        title: group.title,
        reason: "원본 PDF는 '연결 정보가 없는 원본 PDF'에서 따로 삭제합니다.",
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
const SAFE_CHECKLIST_FILE = /^[a-f0-9]{64}\.json$/;

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
function deletionTargets(groups, root, { checklistsDir = null } = {}) {
  const dirs = {
    pages: path.join(root, "documents", "custom-documents"),
    cache: path.join(root, "vector-cache"),
    images: path.join(root, "document-images"),
    originals: path.join(root, "original-documents"),
    checklists: checklistsDir || path.join(root, "document-checklists"),
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
    for (const relative of group.pagePaths || []) {
      const parts = String(relative).split("/");
      if (parts.length < 2 || parts.some(p => !p || p === "." || p === ".." || p.includes("\\") || p.includes(":")) || !SAFE_PAGE_FILE.test(parts.at(-1)))
        throw new Error("unsafe page path");
      let target = path.join(root, "documents");
      for (const part of parts) {
        target = path.join(target, part);
        if (fs.lstatSync(target, {throwIfNoEntry:false})?.isSymbolicLink()) throw new Error("unsafe page symlink");
      }
      files.push(target);
    }
    for (const name of group.cacheFileNames || []) {
      if (!SAFE_CACHE_FILE.test(name)) throw new Error("unsafe cache file");
      add(files, dirs.cache, name);
    }
    for (const name of group.checklistFiles || []) {
      if (!SAFE_CHECKLIST_FILE.test(name))
        throw new Error("unsafe checklist file");
      add(files, dirs.checklists, name);
    }
    // 문서 번호가 없는 예전 형식 파일은 쪽 파일·캐시만 지움(이미지·원본 없음).
    if (group.legacy === true && group.documentId === null) continue;
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
    checklistsDir = null,
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

  // 실제 운영 경로에서는 체크리스트 저장 위치를 그대로 씀(환경 변수 설정 포함).
  const targets = deletionTargets(selected, root, {
    checklistsDir:
      checklistsDir ||
      (root === storageRoot()
        ? require("../documentChecklists/repository").ChecklistRepository
            .storageRoot
        : null),
  });
  const manifest = buildCleanupManifest(before, keys, {
    adminUsername: actorId ? `user:${actorId}` : null,
    at,
  });
  // 원본 PDF를 지우기 전에 "삭제됨" 표시를 남겨, 과거 답변에서 출처를 열면
  // 오류 대신 "이전 버전 문서라 원문을 확인할 수 없습니다" 안내가 나오게 함.
  const { markOriginalPdfDeletion } = require("../originalDocuments");
  for (const group of selected.filter(
    (g) => g.original?.exists && g.documentId
  ))
    markOriginalPdfDeletion(group.documentId, {
      storageRoot:
        root === storageRoot() ? undefined : path.join(root, "original-documents"),
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

/**
 * 연결 정보가 없는 원본 PDF 삭제. Each selected original is judged again on a
 * fresh scan right before deletion; only one still "unlinked" is removed (its
 * .pdf and metadata .json in original-documents, nothing else). Every other
 * selection is refused with its own reason, and the operational counts must be
 * unchanged afterwards.
 */
async function executeOriginalPdfCleanup(
  keys = [],
  { loadInputs = loadStorageCleanupInputs, root = storageRoot(), verifyReview } = {}
) {
  // The initial scan selects lock keys only. Never authorize from this scan:
  // a restore may finish while its asynchronous database reads are running.
  const initial = classifyStorage(await loadInputs());
  const selected = new Set(keys);
  const storageKeys = initial.groups.filter(group=>selected.has(group.key) && group.kind==='original').map(group=>group.originalKey);
  return require('../originalDocuments').withOriginalPdfLocks(storageKeys,
    ()=>executeOriginalPdfCleanupLocked(keys,{loadInputs,root,verifyReview,lockedKeys:new Set(storageKeys)}),
    {storageRoot:path.join(root,'original-documents')});
}

async function executeOriginalPdfCleanupLocked(
  keys = [],
  { loadInputs = loadStorageCleanupInputs, root = storageRoot(), verifyReview, lockedKeys } = {}
) {
  const before = classifyStorage(await loadInputs());
  if(verifyReview && verifyReview(before)!==true) return {
    ok:false,deleted:0,refused:keys.length,freedBytes:0,results:[],changed:[],report:before,
    message:'연결 정보가 바뀌었거나 확인 시간이 지났습니다. 다시 확인해 주세요.',
  };
  const byKey = new Map(before.groups.map((g) => [g.key, g]));
  const dir = path.join(root, "original-documents");
  const results = [];
  let freedBytes = 0;
  for (const key of [...new Set(keys.map(String))]) {
    const group = byKey.get(key);
    const refuse = (reason) => results.push({ key, deleted: false, reason });
    if (!group) {
      refuse("항목을 찾을 수 없습니다. 목록을 새로 고쳐 주세요.");
      continue;
    }
    if (group.kind !== "original") {
      refuse("원본 PDF 항목이 아닙니다.");
      continue;
    }
    if(!lockedKeys.has(group.originalKey)) {
      refuse('확인 중 원본 목록이 바뀌었습니다. 다시 확인해 주세요.');
      continue;
    }
    if (
      (group.status !== STATUS.UNLINKED && !(verifyReview && group.status === STATUS.REVIEW && group.references && group.documentId)) ||
      !/^[a-f0-9]{64}$/.test(group.originalKey || "")
    ) {
      refuse(
        group.reasons?.[0] ||
          "현재 자료와 연결되어 있을 수 있어 삭제하지 않았습니다."
      );
      continue;
    }
    const targets = [`${group.originalKey}.pdf`, `${group.originalKey}.json`]
      .map((name) => path.join(dir, name))
      .filter((target) => isInside(dir, target));
    if(group.documentId) {
      try {require('../originalDocuments').markOriginalPdfDeletion(group.documentId,{storageRoot:dir});}
      catch {refuse('삭제 안내를 준비하지 못해 파일을 보존했습니다.');continue;}
    }
    const outcome = removeTargets({ files: targets, folders: [] });
    if (outcome.failed.length) {
      refuse("파일을 지우지 못했습니다.");
      continue;
    }
    freedBytes += outcome.bytes;
    results.push({ key, deleted: true, bytes: outcome.bytes });
  }

  const after = classifyStorage(await loadInputs());
  const comparison = compareOperationalSnapshots(
    before.summary.current,
    after.summary.current
  );
  const deleted = results.filter((r) => r.deleted).length;
  return {
    ok: comparison.ok && deleted > 0 && deleted === results.length,
    deleted,
    refused: results.length - deleted,
    freedBytes,
    results,
    before: before.summary.current,
    after: after.summary.current,
    changed: comparison.changed,
    report: after,
  };
}

function publicGroup(group) {
  const {
    documentId: _hidden,
    originalKey: _originalKey,
    originalName: _originalName,
    pageFiles: _pages,
    pagePaths: _pagePaths,
    cacheFileNames: _cache,
    checklistFiles: _checklistFiles,
    references,
    ...rest
  } = group;
  return { ...rest, ...(references !== undefined ? {references:references ? {counts:references.counts} : null}:{}), totalBytes: groupBytes(group) };
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
  if (!fs.existsSync(documentsDir)) return [];
  const paths = [];
  function visit(dir, prefix = "") {
    for (const entry of fs.readdirSync(dir, {withFileTypes:true})) {
      if (entry.isSymbolicLink()) continue;
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) visit(path.join(dir, entry.name), relative);
      else if (entry.isFile() && prefix && entry.name.endsWith(".json")) paths.push(relative);
    }
  }
  visit(documentsDir);
  const cached = new Set(
    cacheDir && fs.existsSync(cacheDir) ? fs.readdirSync(cacheDir) : []
  );
  return paths.map((docpath) => {
      const fileName = path.basename(docpath);
      const full = path.join(documentsDir, docpath);
      const stat = fs.statSync(full);
      const bytes = stat.size;
      const modifiedAt = stat.mtime.toISOString();
      const cacheFiles = vectorCacheNames(docpath)
        .filter((name) => cached.has(name))
        .map((name) => ({
          name,
          bytes: fs.statSync(path.join(cacheDir, name)).size,
        }));
      try {
        const data = JSON.parse(fs.readFileSync(full, "utf8"));
        return {
          fileName,
          docpath,
          documentId: data.document_id || null,
          title: data.title || null,
          page: data.page ?? null,
          published: data.published || null,
          modifiedAt,
          bytes,
          cacheFiles,
        };
      } catch {
        return { fileName, docpath, documentId: null, bytes, modifiedAt };
      }
    });
}

async function loadStorageCleanupInputs() {
  const prisma = require("../prisma");
  const { getVectorDbClass } = require("../helpers");
  const { ChecklistRepository } = require("../documentChecklists/repository");
  const root = storageRoot();

  const rows = await prisma.workspace_documents.findMany({
    select: { id:true, workspaceId:true, docpath: true, docId: true, metadata: true },
  });
  const referenceIdentities={checklists:[],workspaces:[],search:[],images:[]};
  const workspaceDocumentIds = new Set();
  // 현재 등록 문서 번호(같은 이름 업데이트로 보관된 예전 버전 제외): 체크리스트 수 계산용
  const liveDocumentIds = new Set();
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
    if (metadata.document_id && metadata.schat_document_update_archived !== true)
      liveDocumentIds.add(String(metadata.document_id).trim());
    if(metadata.document_id)referenceIdentities.workspaces.push({document_id:String(metadata.document_id).trim(),id:JSON.stringify([row.id,row.workspaceId,row.docId,row.docpath])});
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
  // A collection that fails to load (other than "does not exist") makes the
  // reference scan incomplete: then no original PDF is judged unused.
  let chromaIncomplete = false;
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
        .catch((error) => {
          if (!/does not exist|not found|not exist/i.test(error?.message || ""))
            chromaIncomplete = true;
          return null;
        });
      if (!collection) continue;
      const total = await collection.count();
      for (let offset = 0; offset < total; offset += 500) {
        const page = await collection.get({
          limit: 500,
          offset,
          include: ["metadatas"],
        });
        for (const [index,metadata] of (page.metadatas || []).entries()) {
          if (metadata?.document_id)
            chromaDocumentIds.add(metadata.document_id);
          if(metadata?.document_id) {
            if(!page.ids?.[index])chromaIncomplete=true;
            else referenceIdentities.search.push({document_id:metadata.document_id,id:JSON.stringify([slug,page.ids[index]])});
          }
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
  const checklistFilesByDocument = new Map();
  for (const { name, checklist } of ChecklistRepository.listEntries()) {
    if (!checklist?.documentId) continue;
    checklistFilesByDocument.set(checklist.documentId, [
      ...(checklistFilesByDocument.get(checklist.documentId) || []),
      name,
    ]);
    referenceIdentities.checklists.push({document_id:checklist.documentId,id:checklist.id});
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
          for(const name of fs.readdirSync(full,{recursive:true}).sort())
            referenceIdentities.images.push({document_id:e.name,id:String(name)});
          referenceIdentities.images.push({document_id:e.name,id:'folder:'+e.name});
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
          let originalName = null;
          try {
            const metadata = JSON.parse(fs.readFileSync(meta, 'utf8'));
            if (typeof metadata.filename === 'string' && metadata.filename.trim())
              originalName = metadata.filename;
          } catch { /* An unidentified original cannot pass the deletion lock. */ }
          return {
            storageKey,
            originalName,
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

  // Every document id still mentioned anywhere, for the original PDF check:
  // live workspace, search data, checklists, image folders, quizzes and the
  // sources saved with past answers (Citation). Any failure -> null (no
  // original is then judged unused).
  let knownDocumentIds = null;
  let originalReferences = null;
  const pageRecords = readPageRecords(
    path.join(root, "documents"),
    path.join(root, "vector-cache")
  );
  if (!chromaIncomplete) {
    try {
      const ids = new Set([
        ...workspaceDocumentIds,
        ...chromaDocumentIds,
        ...checklistDocumentIds.keys(),
        ...imageFolders.map((folder) => folder.name),
      ]);
      const quizRows = [];
      for (const table of [
        "schat_quiz_sets",
        "schat_quiz_questions",
        "schat_quiz_generation_logs",
      ]) {
        const rows = await prisma[table].findMany({
          select: { id:true, document_id: true,
            ...(table === "schat_quiz_questions" ? { status: true } : {}) },
        });
        // 지운 문제(deleted)는 현재 퀴즈로 세지 않음
        quizRows.push(rows.filter((row) => row.status !== "deleted"));
        for (const row of rows)
          if (row.document_id) ids.add(String(row.document_id).trim());
      }
      const chats = await prisma.workspace_chats.findMany({
        select: { id:true, response: true },
      });
      for (const chat of chats)
        for (const match of String(chat.response || "").matchAll(
          /"document_id"\s*:\s*"([^"]{1,200})"/g
        ))
          ids.add(match[1].trim());
      // 요즘 답변의 출처는 문서 번호 대신 pdfRef(문서 번호로 계산한 값)만
      // 저장함. 알고 있는 문서 번호와 남은 쪽 파일의 문서 번호로 pdfRef를
      // 다시 계산해, 그 출처를 쓴 과거 답변도 그 문서의 과거 답변으로 셈.
      const { pdfRefForDocumentId } = require("../originalDocuments");
      const refOptions =
        root === storageRoot()
          ? {}
          : { storageRoot: path.join(root, "original-documents") };
      const documentByRef = new Map();
      for (const id of [
        ...ids,
        ...pageRecords.map((record) => record.documentId),
      ]) {
        const ref = id ? pdfRefForDocumentId(String(id), refOptions) : null;
        if (ref) documentByRef.set(ref, String(id).trim());
      }
      const chatsWithRefs = chats.map((chat) => {
        const linked = new Set();
        for (const match of String(chat.response || "").matchAll(
          /"(?:pdfRef|spreadsheetRef)"\s*:\s*"([A-Za-z0-9_-]{16,128})"/g
        ))
          if (documentByRef.has(match[1])) linked.add(documentByRef.get(match[1]));
        if (!linked.size) return chat;
        for (const id of linked) ids.add(id);
        return {
          id: chat.id,
          response: JSON.stringify({
            saved: JSON.parse(chat.response),
            pdfRefDocuments: [...linked].map((document_id) => ({ document_id })),
          }),
        };
      });
      knownDocumentIds = ids;
      originalReferences = collectOriginalReferences({chats:chatsWithRefs,quizSets:quizRows[0],quizQuestions:quizRows[1],quizRuns:quizRows[2],
        checklists:checklistDocumentIds,workspaceDocumentIds,chromaDocumentIds,imageFolders,referenceIdentities});
    } catch {
      knownDocumentIds = null;
    }
  }

  return {
    knownDocumentIds,
    originalReferences,
    pageRecords,
    workspaceDocs,
    vectorDocIds: new Set(vectorRows.map((r) => r.docId)),
    chromaDocumentIds,
    workspaceDocumentIds,
    imageVectorsByDocument,
    relatedImageFolders,
    checklistDocumentIds,
    checklistFilesByDocument,
    liveDocumentIds,
    imageFolders,
    originals,
    descriptionCache: folderStats(path.join(imagesDir, ".description-cache")),
    vectorCounts,
  };
}

module.exports = {
  STATUS,
  groupKey,
  classifyStorage,
  buildCleanupPreview,
  buildCleanupManifest,
  compareOperationalSnapshots,
  executeStorageCleanup,
  executeOriginalPdfCleanup,
  deletionTargets,
  publicReport,
  loadStorageCleanupInputs,
  originalStorageKey,
  vectorCacheNames,
  readPageRecords,
};
