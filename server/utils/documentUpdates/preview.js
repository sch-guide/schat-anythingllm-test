const fs = require("node:fs/promises");
const path = require("node:path");

function identity(name) {
  return name.replace(/\\/g, "/").split("/").pop().normalize("NFC").toLowerCase();
}

// Read-only preflight. Returned paths are references, never permission to delete.
// The replacement endpoint must recheck them under its transaction lock.
// registered: 작업공간에 연결된 docpath 목록(Set). 주면 연결 안 된 남은 파일
// (작업공간에서 뺀 문서의 쪽 파일 등)은 기존 자료로 보지 않아 일반 업로드로 감.
async function previewDocumentUpdates({ root, names, registered = null }) {
  if (!Array.isArray(names) || !names.length || names.length > 1000 ||
      names.some(name => typeof name !== "string" || !name.trim() ||
        name.length > 1024 || /[\u0000-\u001f]/.test(name) ||
        name.replace(/\\/g, "/").split("/").some(part => !part || part === "." || part === ".."))) {
    throw new Error("INVALID_UPLOAD_NAMES");
  }
  const requested = new Map();
  for (const name of names) {
    const key = identity(name);
    if (requested.has(key)) throw new Error("DUPLICATE_BATCH_NAME");
    requested.set(key, { name, documents: [] });
  }

  async function visit(directory, relative = "") {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    entries.sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
    for (const entry of entries) {
      const filename = path.join(directory, entry.name);
      const docpath = relative ? `${relative}/${entry.name}` : entry.name;
      // Do not follow links into another directory or silently skip an unknown catalog.
      if (entry.isSymbolicLink()) throw new Error("DOCUMENT_CATALOG_LINK_UNSUPPORTED");
      if (entry.isDirectory()) {
        await visit(filename, docpath);
        continue;
      }
      if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
      if (registered && !registered.has(docpath)) continue;
      let data;
      try {
        data = JSON.parse(await fs.readFile(filename, "utf8"));
      } catch {
        throw new Error("DOCUMENT_IDENTITY_UNAVAILABLE");
      }
      if (typeof data?.title !== "string" || !data.title.trim()) {
        throw new Error("DOCUMENT_IDENTITY_UNAVAILABLE");
      }
      const keys = new Set([identity(data.title)]);
      // Spreadsheet titles may contain a sheet suffix; the collector URL keeps
      // the original uploaded file name. Do not treat arbitrary web URLs as files.
      if (typeof data.url === "string" && data.url.startsWith("file://")) {
        keys.add(identity(data.url.slice(7)));
      }
      for (const key of keys) {
        const match = requested.get(key);
        if (match) match.documents.push({
          docpath,
          documentId: typeof data.document_id === "string" ? data.document_id : null,
        });
      }
    }
  }
  await visit(root);
  return { conflicts: [...requested.values()].filter(item => item.documents.length) };
}
module.exports = { previewDocumentUpdates };
