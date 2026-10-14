const { maskSensitive } = require("./usageStats");

const PAGE_SIZE = 50;
const MAX_SCAN = 1000;
const MAX_TEXT = 12000;
// 지침별 보기의 "이 문단을 근거로 쓴 질문" 계산에 읽는 최근 질문 수와 보관 시간.
const REFERENCE_SCAN = 3000;
const REFERENCE_TTL_MS = 60 * 1000;
const REFERENCE_ITEMS = 20;
const ANSWER_MAX_TEXT = 60000;
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
function documentName(row) {
  const m = parseObject(row.metadata);
  const name = m.document_name || m.documentName || m.title || row.filename;
  return typeof name === "string" ? name.normalize("NFC").split(/[\\/]/).pop().trim() : "";
}
function documentInfo(row) {
  const metadata = parseObject(row.metadata);
  const page = Number(
    metadata.page ?? metadata.pageNumber ?? metadata.page_number
  );
  return {
    documentId: row.docId,
    name: text(documentName(row)),
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
    page: document.page || (Number.isSafeInteger(page) && page > 0 ? page : null),
    section: text(metadata.section),
    version: document.version || versionOf(metadata),
    text: text(content, MAX_TEXT),
    truncated: typeof content === "string" && content.length > MAX_TEXT,
  };
}
// 저장된 출처와 근거 문단을 대조할 때 공백·전각 차이를 무시한다.
function compact(value) {
  return typeof value === "string"
    ? value.normalize("NFKC").replace(/\s+/g, "").toLocaleLowerCase()
    : "";
}
function baseName(value) {
  return typeof value === "string"
    ? value.normalize("NFC").split(/[\\/]/).pop().trim()
    : "";
}
function numberOf(value) {
  if (value === undefined || value === null || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}
// 저장된 검색 점수. similarity는 의미 검색 유사도(코사인, 0~1),
// score는 예전 경로의 순위 점수로 서로 다른 값이라 따로 돌려준다.
function scoreOf(source) {
  return numberOf(source?.score);
}
function similarityOf(source) {
  return numberOf(source?.similarity);
}
// 저장된 출처 하나가 근거 문단(chunk)과 같은 내용인지 판단한다.
// 문서명과 쪽이 같고, 출처에 남은 인용 문장이 문단 안에 있으면 같은 문단으로 본다.
// 인용 문장이 없거나 너무 짧은 과거 기록은 같은 쪽이면 연결한다.
function sourceMatchesChunk(ref, chunk) {
  if (ref.vectorId && ref.vectorId === chunk.id) return true;
  if (!ref.name || ref.name !== chunk.name) return false;
  if (ref.page && chunk.page && ref.page !== chunk.page) return false;
  if (!ref.page && chunk.page) return false;
  if (ref.excerptKey.length < 15) return true;
  return chunk.compactText.includes(ref.excerptKey);
}
function groupKey(row) {
  // Display grouping only. Individual registration/vector identities stay intact.
  return documentName(row) ? `name:${documentName(row)}` : `id:${row.docId}`;
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
        "현재 연결에서는 근거 문단을 직접 볼 수 없습니다. 질문별로 보기에서 답할 때 참고한 내용을 확인해 주세요."
      );
  }
  async function getDocument(workspaceId, documentId) {
    return db().workspace_documents.findFirst({
      where: { workspaceId, docId: documentId },
    });
  }
  async function registrations(workspaceId) {
    const rows = [];
    for (let skip = 0; ; skip += MAX_SCAN) {
      const batch = await db().workspace_documents.findMany({
        where: { workspaceId }, orderBy: { id: "desc" }, skip, take: MAX_SCAN,
      });
      rows.push(...batch);
      if (batch.length < MAX_SCAN) return rows;
    }
  }
  async function members(workspaceId, row) {
    const key = groupKey(row);
    return (await registrations(workspaceId)).filter((r) => groupKey(r) === key)
      .sort((a, b) => (documentInfo(a).page || 0) - (documentInfo(b).page || 0)
        || a.docId.localeCompare(b.docId));
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
  // 최근 질문의 저장 출처를 읽어 문단별 참조를 계산한다(읽기 전용, 짧게 보관).
  const referenceCache = new Map();
  async function chatReferences(workspaceId) {
    const cached = referenceCache.get(workspaceId);
    if (cached && Date.now() - cached.at < REFERENCE_TTL_MS) return cached.refs;
    const rows = await db().workspace_chats.findMany({
      where: { workspaceId, api_session_id: null },
      orderBy: { id: "desc" },
      take: REFERENCE_SCAN,
      select: { id: true, prompt: true, response: true, createdAt: true },
    });
    const refs = [];
    for (const row of rows) {
      const response = parseObject(row.response);
      const sources = Array.isArray(response.sources) ? response.sources : [];
      for (const entry of sources.slice(0, PAGE_SIZE)) {
        const source = parseObject(entry?.metadata || entry);
        const page = Number(source.page);
        const excerpt = compact(source.excerpt || source.text || "");
        refs.push({
          chatId: row.id,
          question: row.prompt,
          createdAt: row.createdAt,
          vectorId: text(source.chunk_id || source.id),
          name: baseName(
            source.documentName || source.document_name || source.title || ""
          ),
          page: Number.isSafeInteger(page) && page > 0 ? page : null,
          // 앞부분 일부만 비교해 출처 머리말·생략 차이에 덜 민감하게 한다.
          excerptKey: excerpt.slice(0, 40),
          score: scoreOf(source),
          similarity: similarityOf(source),
        });
      }
    }
    if (referenceCache.size > 20) referenceCache.clear();
    referenceCache.set(workspaceId, { at: Date.now(), refs });
    return refs;
  }
  function referencesFor(refs, chunk) {
    const target = { ...chunk, compactText: compact(chunk.text) };
    const chats = new Map();
    for (const ref of refs) {
      if (!sourceMatchesChunk(ref, target)) continue;
      const known = chats.get(ref.chatId);
      if (known) {
        if (ref.similarity !== null && (known.similarity === null || ref.similarity > known.similarity))
          known.similarity = ref.similarity;
        if (ref.score !== null && (known.score === null || ref.score > known.score))
          known.score = ref.score;
        continue;
      }
      chats.set(ref.chatId, {
        id: ref.chatId,
        question: maskSensitive(ref.question).slice(0, 300),
        createdAt: date(ref.createdAt),
        similarity: ref.similarity,
        score: ref.score,
      });
    }
    const items = [...chats.values()].sort((a, b) => b.id - a.id);
    return { count: items.length, items: items.slice(0, REFERENCE_ITEMS) };
  }
  function documentReferenceCount(refs, name) {
    return new Set(refs.filter((ref) => ref.name === name).map((ref) => ref.chatId)).size;
  }
  // 직원이 실제로 본 답변을 그대로 돌려준다. 내용은 저장된 값만 사용하고 새로 만들지 않는다.
  function storedAnswer(response) {
    const textValue = typeof response.text === "string" ? response.text : null;
    const sources = (Array.isArray(response.sources) ? response.sources : [])
      .slice(0, PAGE_SIZE)
      .map((entry) => parseObject(entry?.metadata || entry))
      // 채팅 화면이 받는 출처와 같은 값. 내부 벡터 본문 머리말은 이미 제거되어 저장된다.
      .map(({ vector, embedding, ...source }) => source);
    const missing = [];
    if (textValue === null) missing.push("답변 본문");
    if (!Array.isArray(response.sources)) missing.push("출처");
    return {
      available: textValue !== null,
      text: textValue === null ? "" : textValue.slice(0, ANSWER_MAX_TEXT),
      textTruncated: textValue !== null && textValue.length > ANSWER_MAX_TEXT,
      type: typeof response.type === "string" ? response.type : null,
      sources,
      presentation:
        response.presentation && typeof response.presentation === "object"
          ? response.presentation
          : null,
      relatedImages: Array.isArray(response.relatedImages)
        ? response.relatedImages
        : [],
      missing,
    };
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
      const groups = new Map();
      for (const row of await registrations(workspace.id)) {
        const key = groupKey(row);
        if (!groups.has(key)) groups.set(key, { ...documentInfo(row), page: null, pages: new Set(), statuses: new Set(), versions: new Set() });
        groups.get(key).statuses.add(documentInfo(row).status);
        groups.get(key).versions.add(documentInfo(row).version);
        const p = documentInfo(row).page;
        if (p) groups.get(key).pages.add(p);
      }
      const refs = await chatReferences(workspace.id).catch(() => null);
      const rows = [...groups.values()].map(({ pages, statuses, versions, ...doc }) => ({
        ...doc, pageCount: pages.size,
        referenceCount: refs ? documentReferenceCount(refs, doc.name) : null,
        status: statuses.size > 1 ? "mixed" : doc.status,
        version: versions.size > 1 ? null : doc.version,
      }));
      return page(
        rows.slice(offset, offset + PAGE_SIZE),
        offset + PAGE_SIZE,
        rows.length > offset + PAGE_SIZE
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
      const group = await members(workspace.id, row);
      const byId = new Map(group.map((r) => [r.docId, documentInfo(r)]));
      const order = new Map(group.map((r, i) => [r.docId, i]));
      const allMappings = await db().document_vectors.findMany({
        where: { docId: { in: group.map((r) => r.docId) } },
        orderBy: { id: "asc" }, take: 100001,
        select: { docId: true, vectorId: true },
      });
      if (allMappings.length > 100000) fail(422, "문서가 너무 커서 한 번에 조회할 수 없습니다.");
      allMappings.sort((a, b) => order.get(a.docId) - order.get(b.docId));
      const collection = await getCollection(workspace);
      const items = [];
      let cursor = offset;
      let scanned = 0;
      let hasMore = true;
      while (items.length < PAGE_SIZE && scanned < MAX_SCAN && hasMore) {
        const mappings = allMappings.slice(cursor, cursor + PAGE_SIZE + 1);
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
                  byId.get(batch[i].docId)
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
      const latest = await members(workspace.id, row);
      if (latest.length !== group.length || group.some((r, i) => !sameRegistration(r, latest[i])))
        fail(409, "조회 중 문서 등록 상태가 바뀌었습니다. 잠시 뒤 다시 조회해 주세요.");
      // 참조 계산이 실패해도 문단 조회는 그대로 보여 준다.
      const refs = await chatReferences(workspace.id).catch(() => null);
      return {
        ...page(
          refs ? items.map((item) => ({ ...item, references: referencesFor(refs, item) })) : items,
          cursor,
          hasMore
        ),
        document: refs
          ? { ...document, referenceCount: documentReferenceCount(refs, document.name) }
          : document,
        referenceScan: REFERENCE_SCAN,
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
          similarity: similarityOf(source),
          score: scoreOf(source),
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
        answer: storedAnswer(response),
        sourcesTruncated: allSources.length > PAGE_SIZE,
        notice: lookupFailed
          ? "근거 문단을 불러오지 못했습니다. 답할 때 참고한 내용을 표시합니다."
          : provider() !== "chroma"
            ? "현재 연결에서는 근거 문단을 직접 볼 수 없습니다. 답할 때 참고한 내용을 표시합니다."
            : null,
      };
    },
  };
}
module.exports = { createChunkViewer };
