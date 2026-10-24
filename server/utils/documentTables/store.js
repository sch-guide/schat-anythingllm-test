// 쪽별 "표 정리" 저장소 (2026-10-24).
//
// PDF에서 글자만 뽑으면 표의 행·열(특히 여러 칸을 합친 칸)이 사라져, AI가 "72시간 유효"처럼
// 한 열에만 해당하는 내용을 다른 열에도 해당한다고 읽는 일이 있었다(수혈 전 검사 주기 표).
// 표가 있는 쪽을 그림으로 보고 행·열대로 옮긴 글을 여기 따로 저장해 두고, 답변 때 그 쪽이
// 근거로 잡히면 함께 넘긴다. 검색 자료(Chroma·BM25)는 바꾸지 않는다.
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const MAX_TEXT = 6000;
const CACHE_TTL_MS = 60 * 1000;
const cache = new Map();

function tablesRoot(storageRoot) {
  if (storageRoot) return path.resolve(storageRoot);
  if (process.env.STORAGE_DIR)
    return path.resolve(process.env.STORAGE_DIR, "document-tables");
  return path.resolve(__dirname, "../../storage/document-tables");
}
function documentFolder(documentId, storageRoot) {
  const key = crypto.createHash("sha256").update(String(documentId)).digest("hex");
  return path.join(tablesRoot(storageRoot), key);
}
function validPage(page) {
  const value = Number(page);
  return Number.isInteger(value) && value > 0 && value < 100000 ? value : null;
}

/** 쪽의 표 정리 글. 없거나 "표 없음"이면 "". */
function readTableText(documentId, page, { storageRoot } = {}) {
  const pageNumber = validPage(page);
  if (!documentId || !pageNumber) return "";
  const file = path.join(documentFolder(documentId, storageRoot), `${pageNumber}.json`);
  const hit = cache.get(file);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.text;
  let text = "";
  try {
    const saved = JSON.parse(fs.readFileSync(file, "utf8"));
    text = typeof saved?.text === "string" ? saved.text.slice(0, MAX_TEXT) : "";
  } catch {
    text = "";
  }
  if (cache.size > 2000) cache.clear();
  cache.set(file, { at: Date.now(), text });
  return text;
}

/** 이미 확인한 쪽인지(표가 없다는 결과도 기록으로 남김). */
function hasTableRecord(documentId, page, { storageRoot } = {}) {
  const pageNumber = validPage(page);
  if (!documentId || !pageNumber) return false;
  return fs.existsSync(path.join(documentFolder(documentId, storageRoot), `${pageNumber}.json`));
}

/** text가 ""이면 "표 없음"으로 기록한다. */
function writeTableText(documentId, page, text, { model = null, storageRoot } = {}) {
  const pageNumber = validPage(page);
  if (!documentId || !pageNumber) throw new Error("invalid_table_page");
  const folder = documentFolder(documentId, storageRoot);
  fs.mkdirSync(folder, { recursive: true });
  const file = path.join(folder, `${pageNumber}.json`);
  const body = {
    version: 1,
    documentId: String(documentId),
    page: pageNumber,
    text: String(text || "").trim().slice(0, MAX_TEXT),
    model,
    createdAt: new Date().toISOString(),
  };
  const temp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(body, null, 1));
  fs.renameSync(temp, file);
  cache.delete(file);
  return body;
}

module.exports = { readTableText, hasTableRecord, writeTableText, tablesRoot, MAX_TEXT };
