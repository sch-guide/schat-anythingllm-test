// SCHAT 문서 등록 창의 왼쪽 목록. PDF는 쪽마다 JSON 파일로 저장되므로
// (예: 593개 파일 = 문서 4개) 같은 document_id끼리 묶어 문서 한 줄로 돌려줌.
// 읽기만 함: 파일·DB·검색 데이터는 바꾸지 않음. 본문(pageContent)은 보내지 않음.
const fs = require("node:fs/promises");
const path = require("node:path");

function baseName(value = "") {
  return String(value).replace(/\\/g, "/").split("/").pop().normalize("NFC");
}

async function readCatalog(root) {
  const files = [];
  async function visit(directory, relative = "") {
    let entries = [];
    try {
      entries = await fs.readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const full = path.join(directory, entry.name);
      const docpath = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        await visit(full, docpath);
        continue;
      }
      if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
      try {
        const data = JSON.parse(await fs.readFile(full, "utf8"));
        if (typeof data?.title !== "string" || !data.title.trim()) continue;
        files.push({
          docpath,
          folderName: relative.split("/")[0] || "",
          name: entry.name,
          id: typeof data.id === "string" ? data.id : docpath,
          title: data.title,
          documentId:
            typeof data.document_id === "string" ? data.document_id : null,
          page: Number.isInteger(Number(data.page)) ? Number(data.page) : null,
          published: data.published || null,
        });
      } catch {
        // 읽을 수 없는 파일은 목록에서만 뺌(파일은 그대로 둠).
      }
    }
  }
  await visit(root);
  return files;
}

function summarize(
  files,
  rows,
  workspaceId,
  pdfMeta = () => ({}),
  keyOf = () => null
) {
  const byPath = new Map();
  for (const row of rows) {
    let archived = false;
    try {
      archived =
        JSON.parse(row.metadata || "{}").schat_document_update_archived ===
        true;
    } catch {}
    const list = byPath.get(row.docpath) || [];
    list.push({ workspaceId: row.workspaceId, archived });
    byPath.set(row.docpath, list);
  }
  const groups = new Map();
  for (const file of files) {
    const refs = byPath.get(file.docpath) || [];
    const state = refs.some((r) => r.archived)
      ? "archived"
      : refs.some((r) => r.workspaceId === workspaceId)
        ? "registered"
        : refs.length
          ? "other"
          : "free";
    if (state === "archived" || state === "other") continue;
    const title = baseName(file.title);
    const key = file.documentId ? `id:${file.documentId}` : `title:${title}`;
    const group = groups.get(key) || {
      key,
      documentId: file.documentId,
      title,
      pages: 0,
      registeredPages: 0,
      uploadedAt: null,
      freeFiles: [],
      sample: file,
    };
    group.pages += 1;
    if (state === "registered") group.registeredPages += 1;
    else
      group.freeFiles.push({
        id: file.id,
        name: file.name,
        folderName: file.folderName,
        title: file.title,
        document_id: file.documentId,
        page: file.page,
        type: "file",
      });
    if (
      file.published &&
      (!group.uploadedAt || file.published > group.uploadedAt)
    )
      group.uploadedAt = file.published;
    groups.set(key, group);
  }
  const registeredTitles = new Set(
    [...groups.values()].filter((g) => g.registeredPages).map((g) => g.title)
  );
  return [...groups.values()]
    .map(({ sample, ...group }) => {
      const status = !group.registeredPages
        ? "unregistered"
        : group.freeFiles.length
          ? "partial"
          : "registered";
      return {
        ...group,
        status,
        // 같은 이름의 문서가 이미 등록되어 있는데 이 묶음은 등록되지 않은 경우
        // (작업공간에서 뺀 예전 업로드 등) 따로 표시함.
        olderCopy:
          status === "unregistered" && registeredTitles.has(group.title),
        // 원본 PDF 링크(관리자 화면 원본 보기용)와 안전 점검 열쇠(예전 문서 삭제용).
        ...pdfMeta({ document_id: group.documentId, title: group.title }),
        cleanupKey: group.documentId ? keyOf(group.documentId) : null,
      };
    })
    .sort(
      (a, b) =>
        Number(a.olderCopy) - Number(b.olderCopy) ||
        String(b.uploadedAt || "").localeCompare(String(a.uploadedAt || "")) ||
        a.title.localeCompare(b.title, "ko")
    );
}

async function documentLibrary({ root, workspaceId, prisma, pdfMeta, keyOf }) {
  const [files, rows] = await Promise.all([
    readCatalog(root),
    prisma.workspace_documents.findMany({
      select: { docpath: true, workspaceId: true, metadata: true },
    }),
  ]);
  return summarize(files, rows, workspaceId, pdfMeta, keyOf);
}

module.exports = { documentLibrary, summarize, readCatalog };
