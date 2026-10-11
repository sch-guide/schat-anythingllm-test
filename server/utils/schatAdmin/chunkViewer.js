const { maskSensitive } = require("./usageStats");

const PAGE_SIZE = 50;
const MAX_SCAN = 1000;
const MAX_TEXT = 12000;
function fail(status, message) {
  const error = new Error(message);
  error.status = status;
  throw error;
}
function parseObject(value) {
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return {};
    }
  }
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
}
function text(value, max = 200) {
  return typeof value === "string" ? value.slice(0, max) : "";
}
function date(value) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}
function sameRegistration(before, after) {
  return (
    after &&
    before.docId === after.docId &&
    before.metadata === after.metadata &&
    date(before.createdAt) === date(after.createdAt) &&
    date(before.lastUpdatedAt) === date(after.lastUpdatedAt)
  );
}
function offsetOf(value = "0") {
  if (
    typeof value !== "string" ||
    !/^(0|[1-9]\d*)$/.test(value) ||
    Number(value) > 1000000
  )
    fail(400, "페이지 위치를 확인해 주세요.");
  return Number(value);
}
function idOf(value) {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.length > 200 ||
    /[\u0000-\u001f]/.test(value)
  )
    fail(400, "조회할 문서를 선택해 주세요.");
  return value;
}
function versionOf(metadata) {
  for (const key of [
    "document_version",
    "registration_version",
    "version",
    "revision",
  ]) {
    const value = metadata[key];
    if (typeof value === "string" && value.trim()) return value.slice(0, 200);
    if (typeof value === "number" && Number.isFinite(value))
      return String(value);
  }
  return null;
}
function documentInfo(row) {
  const metadata = parseObject(row.metadata);
  const page = Number(
    metadata.page ?? metadata.pageNumber ?? metadata.page_number
  );
  return {
    documentId: row.docId,
    name: text(
      metadata.document_name ||
        metadata.documentName ||
        metadata.title ||
        row.filename
    ),
    page: Number.isSafeInteger(page) && page > 0 ? page : null,
    version: versionOf(metadata),
    registeredAt: date(row.createdAt),
    status:
      metadata.schat_document_update_archived === true ? "previous" : "current",
  };
}
function chunkInfo(id, content, metadata, document) {
  metadata = parseObject(metadata);
  const page = Number(
    metadata.page ?? metadata.pageNumber ?? metadata.page_number
  );
  return {
    id,
    ...document,
    page: Number.isSafeInteger(page) && page > 0 ? page : null,
    section: text(metadata.section),
    version: versionOf(metadata) || document.version,
    text: text(content, MAX_TEXT),
    truncated: typeof content === "string" && content.length > MAX_TEXT,
  };
}
function page(items, offset, hasMore) {
  return { items, hasMore, nextOffset: hasMore ? offset : null };
}
function validateChunks(stored) {
  if (
    !Array.isArray(stored?.ids) ||
    !Array.isArray(stored.documents) ||
    !Array.isArray(stored.metadatas) ||
    stored.ids.length !== stored.documents.length ||
    stored.ids.length !== stored.metadatas.length ||
    stored.documents.some((content) => typeof content !== "string")
  )
    throw new Error("INVALID_CHUNK_RESPONSE");
}

// Reuse only Chroma's read connection and collection-name normalization. Its
// constructor/search methods carry unrelated update/embedding behavior.
async function readCollection(workspace) {
  const { Chroma } = require("../vectorDbProviders/chroma");
  const reader = { normalize: Chroma.prototype.normalize };
  const { client } = await Chroma.prototype.connect.call(reader);
  return client.getCollection({ name: reader.normalize(workspace.slug) });
}

function createChunkViewer({
  prisma,
  getCollection = readCollection,
  provider = () => process.env.VECTOR_DB,
} = {}) {
  const db = () => prisma || require("../prisma");
  function requireChroma() {
    if (provider() !== "chroma")
      fail(
        422,
        "현재 검색 조각 직접 조회는 Chroma 연결에서만 지원합니다. 저장된 답변 근거는 질문별 탭에서 확인할 수 있습니다."
      );
  }
  async function getDocument(workspaceId, documentId) {
    return db().workspace_documents.findFirst({
      where: { workspaceId, docId: documentId },
    });
  }
  async function sourceDocument(workspaceId, source, vectorId) {
    // source.document_id can be the whole PDF's ID, while docId identifies one
    // registered page. Resolve the exact stored vector before using PDF metadata.
    if (vectorId) {
      const mappings = await db().document_vectors.findMany({
        where: { vectorId: { in: [vectorId] } },
        take: PAGE_SIZE + 1,
        select: { docId: true },
      });
      if (mappings.length && mappings.length <= PAGE_SIZE) {
        const rows = await db().workspace_documents.findMany({
          where: {
            workspaceId,
            docId: { in: [...new Set(mappings.map((v) => v.docId))] },
          },
          take: 2,
        });
        if (rows.length === 1) return rows[0];
      }
    }
    const sourceId = text(source.document_id || source.documentId);
    if (!sourceId) return null;
    const direct = await getDocument(workspaceId, sourceId);
    if (direct) return direct;
    const sourcePage = Number(source.page);
    if (!Number.isSafeInteger(sourcePage) || sourcePage <= 0) return null;
    const candidates = await db().workspace_documents.findMany({
      where: { workspaceId, metadata: { contains: sourceId } },
      orderBy: { id: "asc" },
      take: MAX_SCAN + 1,
    });
    if (candidates.length > MAX_SCAN) return null;
    const version = versionOf(source);
    const matches = candidates.filter((row) => {
      const metadata = parseObject(row.metadata);
      return (
        metadata.document_id === sourceId &&
        Number(metadata.page) === sourcePage &&
        (!version || versionOf(metadata) === version)
      );
    });
    return matches.length === 1 ? matches[0] : null;
  }
  function chatSummary(row) {
    return {
      id: row.id,
      question: maskSensitive(row.prompt).slice(0, 300),
      createdAt: date(row.createdAt),
    };
  }
  return {
    async documents(workspace, query = {}) {
      const offset = offsetOf(query.offset);
      const rows = await db().workspace_documents.findMany({
        where: { workspaceId: workspace.id },
        orderBy: { id: "desc" },
        skip: offset,
        take: PAGE_SIZE + 1,
        select: {
          docId: true,
          filename: true,
          metadata: true,
          createdAt: true,
        },
      });
      return page(
        rows.slice(0, PAGE_SIZE).map(documentInfo),
        offset + PAGE_SIZE,
        rows.length > PAGE_SIZE
      );
    },
    async chunks(workspace, query = {}) {
      const documentId = idOf(query.documentId);
      const offset = offsetOf(query.offset);
      if (
        query.q !== undefined &&
        (typeof query.q !== "string" ||
          query.q.length > 200 ||
          /[\u0000-\u001f]/.test(query.q))
      )
        fail(400, "검색어는 200자 이내의 글자로 입력해 주세요.");
      const keyword = (query.q || "")
        .trim()
        .normalize("NFKC")
        .toLocaleLowerCase();
      const row = await getDocument(workspace.id, documentId);
      if (!row) fail(404, "이 작업 공간에서 문서를 찾을 수 없습니다.");
      requireChroma();
      const document = documentInfo(row);
      const collection = await getCollection(workspace);
      const items = [];
      let cursor = offset;
      let scanned = 0;
      let hasMore = true;
      while (items.length < PAGE_SIZE && scanned < MAX_SCAN && hasMore) {
        const mappings = await db().document_vectors.findMany({
          where: { docId: documentId },
          orderBy: { id: "asc" },
          skip: cursor,
          take: PAGE_SIZE + 1,
          select: { vectorId: true },
        });
        const batch = mappings.slice(0, PAGE_SIZE);
        hasMore = mappings.length > PAGE_SIZE;
        if (!batch.length) break;
        const stored = await collection.get({
          ids: batch.map((v) => v.vectorId),
          include: ["documents", "metadatas"],
        });
        validateChunks(stored);
        const positions = new Map(stored.ids.map((id, i) => [id, i]));
        for (let i = 0; i < batch.length; i++) {
          cursor++;
          scanned++;
          const position = positions.get(batch[i].vectorId);
          if (position !== undefined) {
            const content = stored.documents[position];
            if (
              !keyword ||
              (typeof content === "string" &&
                content.normalize("NFKC").toLocaleLowerCase().includes(keyword))
            )
              items.push(
                chunkInfo(
                  batch[i].vectorId,
                  content,
                  stored.metadatas[position],
                  document
                )
              );
          }
          if (items.length === PAGE_SIZE) {
            hasMore = hasMore || i < batch.length - 1;
            break;
          }
        }
      }
      if (!sameRegistration(row, await getDocument(workspace.id, documentId)))
        fail(
          409,
          "조회 중 문서 등록 상태가 바뀌었습니다. 잠시 뒤 다시 조회해 주세요."
        );
      return {
        ...page(items, cursor, hasMore),
        document,
        scanned,
        scanLimited: hasMore && scanned >= MAX_SCAN,
      };
    },
    async chats(workspace, query = {}) {
      const offset = offsetOf(query.offset);
      const rows = await db().workspace_chats.findMany({
        where: { workspaceId: workspace.id, api_session_id: null },
        orderBy: { id: "desc" },
        skip: offset,
        take: PAGE_SIZE + 1,
        select: { id: true, prompt: true, createdAt: true },
      });
      return page(
        rows.slice(0, PAGE_SIZE).map(chatSummary),
        offset + PAGE_SIZE,
        rows.length > PAGE_SIZE
      );
    },
    async chat(workspace, rawId) {
      if (
        typeof rawId !== "string" ||
        !/^[1-9]\d*$/.test(rawId) ||
        !Number.isSafeInteger(Number(rawId))
      )
        fail(400, "조회할 질문 기록을 확인해 주세요.");
      const row = await db().workspace_chats.findFirst({
        where: {
          workspaceId: workspace.id,
          id: Number(rawId),
          api_session_id: null,
        },
        select: { id: true, prompt: true, response: true, createdAt: true },
      });
      if (!row) fail(404, "이 작업 공간에서 질문 기록을 찾을 수 없습니다.");
      const response = parseObject(row.response);
      if (
        typeof row.response === "string" &&
        row.response.trim() &&
        !Object.keys(response).length &&
        row.response.trim() !== "{}"
      )
        fail(422, "저장된 답변 기록을 읽을 수 없습니다.");
      const allSources = Array.isArray(response.sources)
        ? response.sources
        : [];
      const sources = [];
      let collection;
      let lookupFailed = false;
      for (const entry of allSources.slice(0, PAGE_SIZE)) {
        const source = parseObject(entry?.metadata || entry);
        const vectorId = text(source.chunk_id || source.id);
        const doc = await sourceDocument(workspace.id, source, vectorId);
        const documentId = doc?.docId || null;
        let chunk = null;
        if (doc && vectorId && provider() === "chroma") {
          const mappings = await db().document_vectors.findMany({
            where: { docId: documentId, vectorId: { in: [vectorId] } },
            take: 1,
            select: { vectorId: true },
          });
          if (mappings.length) {
            try {
              collection ||= await getCollection(workspace);
              const stored = await collection.get({
                ids: [vectorId],
                include: ["documents", "metadatas"],
              });
              validateChunks(stored);
              const index = stored.ids.indexOf(vectorId);
              if (index >= 0)
                chunk = chunkInfo(
                  vectorId,
                  stored.documents[index],
                  stored.metadatas[index],
                  documentInfo(doc)
                );
            } catch {
              lookupFailed = true;
            }
          }
        }
        const latest = doc ? await getDocument(workspace.id, documentId) : null;
        const registrationChanged = doc && !sameRegistration(doc, latest);
        if (registrationChanged) {
          chunk = null;
          lookupFailed = true;
        }
        const metadata = parseObject(latest?.metadata);
        const pageNumber = Number(source.page);
        sources.push({
          documentId: doc ? documentId : null,
          name:
            text(
              source.documentName ||
                source.document_name ||
                source.title ||
                doc?.filename
            ) || "문서명 확인 불가",
          page:
            Number.isSafeInteger(pageNumber) && pageNumber > 0
              ? pageNumber
              : null,
          version: versionOf(source) || (doc ? versionOf(metadata) : null),
          registeredAt: doc ? date(doc.createdAt) : null,
          status: registrationChanged
            ? "unavailable"
            : metadata.schat_document_update_archived === true
              ? "previous"
              : chunk
                ? "current"
                : "unavailable",
          excerpt: text(source.excerpt || source.text, MAX_TEXT),
          excerptTruncated:
            typeof (source.excerpt || source.text) === "string" &&
            (source.excerpt || source.text).length > MAX_TEXT,
          chunk,
        });
      }
      return {
        ...chatSummary(row),
        sources,
        sourcesTruncated: allSources.length > PAGE_SIZE,
        notice: lookupFailed
          ? "현재 검색 조각 조회에 실패했습니다. 저장된 발췌만 확인할 수 있습니다."
          : provider() !== "chroma"
            ? "현재 연결은 검색 조각 직접 조회를 지원하지 않습니다. 저장된 발췌만 표시합니다."
            : null,
      };
    },
  };
}
module.exports = { createChunkViewer };
