// 지침서 원본 보기의 "보기 전용 자료실" (2026-10-15).
// - 관리자가 올린 PDF를 직원이 화면에서 보기만 한다. 챗봇 답변 검색(ChromaDB)에는 넣지 않는다.
// - 파일 저장만 쓴다(DB 구조 변경 없음): storage/guideline-library/<id>.pdf, <id>.json
// - 쪽별 글자는 관리자 브라우저가 pdf.js로 읽어 보내고, 서버는 PDF 여부와 쪽 수를 직접 확인한다.
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const MAX_PDF_BYTES = 100 * 1024 * 1024;
const MAX_PAGE_TEXT = 20000;
const MAX_TITLE = 120;
const ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function fail(status, message) {
  const error = new Error(message);
  error.status = status;
  throw error;
}

function libraryRoot(storageRoot) {
  const base =
    storageRoot ||
    process.env.STORAGE_DIR ||
    path.resolve(__dirname, "../storage");
  return path.resolve(base, "guideline-library");
}

function validId(id) {
  return typeof id === "string" && ID_PATTERN.test(id);
}

function cleanTitle(value, fallback) {
  const text = String(value || fallback || "")
    .normalize("NFC")
    .replace(/[\u0000-\u001f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_TITLE);
  return text || "제목 없는 자료";
}

function writeAtomic(file, data) {
  const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temporary, data);
  fs.renameSync(temporary, file);
}

async function countPdfPages(buffer) {
  const { PDFDocument } = require("pdf-lib");
  const pdf = await PDFDocument.load(buffer, {
    ignoreEncryption: true,
    updateMetadata: false,
  });
  return pdf.getPageCount();
}

function publicItem(meta) {
  return {
    id: meta.id,
    title: meta.title,
    pageCount: meta.pageCount,
    uploadedAt: meta.uploadedAt,
    textPages: meta.textPages,
  };
}

function readMeta(root, id) {
  try {
    return JSON.parse(fs.readFileSync(path.join(root, `${id}.json`), "utf8"));
  } catch {
    return null;
  }
}

/** 자료 목록(글자 본문 제외). 원본 PDF가 있는 항목만. */
function listLibraryItems({ storageRoot } = {}) {
  const root = libraryRoot(storageRoot);
  if (!fs.existsSync(root)) return [];
  return fs
    .readdirSync(root)
    .filter((name) => name.endsWith(".json"))
    .map((name) => name.slice(0, -5))
    .filter(validId)
    .map((id) => readMeta(root, id))
    .filter((meta) => meta && fs.existsSync(path.join(root, `${meta.id}.pdf`)))
    .map(publicItem)
    .sort((a, b) => a.title.localeCompare(b.title, "ko"));
}

/** 검색용: 자료별 쪽 글자 */
function libraryPageTexts({ storageRoot } = {}) {
  const root = libraryRoot(storageRoot);
  return listLibraryItems({ storageRoot }).map((item) => ({
    ...item,
    pages: (readMeta(root, item.id)?.pages || []).filter(
      (page) => Number.isInteger(page?.page) && typeof page?.text === "string"
    ),
  }));
}

/**
 * PDF 저장. pages: [{page, text}] (관리자 브라우저가 읽은 쪽별 글자, 없으면 검색만 안 됨)
 */
async function saveLibraryItem(
  { buffer, filename, title, pages = [], now = new Date() },
  { storageRoot, countPages = countPdfPages } = {}
) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0)
    fail(400, "PDF 파일을 골라 주세요.");
  if (buffer.length > MAX_PDF_BYTES)
    fail(413, "PDF는 100MB까지 올릴 수 있습니다.");
  if (buffer.subarray(0, 5).toString("latin1") !== "%PDF-")
    fail(415, "PDF 파일만 올릴 수 있습니다.");
  let pageCount;
  try {
    pageCount = await countPages(buffer);
  } catch {
    fail(422, "PDF를 읽지 못했습니다. 파일이 손상되었는지 확인해 주세요.");
  }
  if (!Number.isInteger(pageCount) || pageCount < 1)
    fail(422, "PDF 쪽 수를 확인하지 못했습니다.");
  const cleanPages = (Array.isArray(pages) ? pages : [])
    .filter(
      (entry) =>
        Number.isInteger(entry?.page) &&
        entry.page >= 1 &&
        entry.page <= pageCount &&
        typeof entry.text === "string"
    )
    .map((entry) => ({
      page: entry.page,
      text: entry.text.normalize("NFC").slice(0, MAX_PAGE_TEXT),
    }));
  const id = crypto.randomUUID();
  const root = libraryRoot(storageRoot);
  fs.mkdirSync(root, { recursive: true });
  const meta = {
    id,
    title: cleanTitle(title, String(filename || "").replace(/\.pdf$/i, "")),
    pageCount,
    textPages: cleanPages.filter((entry) => entry.text.trim()).length,
    uploadedAt: now.toISOString(),
    pages: cleanPages,
  };
  writeAtomic(path.join(root, `${id}.pdf`), buffer);
  writeAtomic(path.join(root, `${id}.json`), JSON.stringify(meta));
  return publicItem(meta);
}

function removeLibraryItem(id, { storageRoot } = {}) {
  if (!validId(id)) fail(400, "삭제할 자료를 확인해 주세요.");
  const root = libraryRoot(storageRoot);
  if (!readMeta(root, id)) fail(404, "자료를 찾을 수 없습니다.");
  fs.rmSync(path.join(root, `${id}.pdf`), { force: true });
  fs.rmSync(path.join(root, `${id}.json`), { force: true });
  return true;
}

function libraryPdfPath(id, { storageRoot } = {}) {
  if (!validId(id)) return null;
  const file = path.join(libraryRoot(storageRoot), `${id}.pdf`);
  return fs.existsSync(file) ? file : null;
}

module.exports = {
  MAX_PDF_BYTES,
  listLibraryItems,
  libraryPageTexts,
  saveLibraryItem,
  removeLibraryItem,
  libraryPdfPath,
};
