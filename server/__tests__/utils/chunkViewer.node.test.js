const test = require("node:test");
const assert = require("node:assert/strict");
const target = "../../utils/schatAdmin/chunkViewer";
const { createChunkViewer } = (() => {
  try {
    return require(target);
  } catch (error) {
    if (error.code === "MODULE_NOT_FOUND") return {};
    throw error;
  }
})();
function fixture({
  count = 3,
  provider = "chroma",
  broken = false,
  archived = false,
} = {}) {
  const docs = [
    {
      id: 1,
      docId: "doc-a",
      workspaceId: 1,
      filename: "시험 문서.pdf",
      createdAt: new Date("2026-10-01"),
      metadata: JSON.stringify({
        schat_document_update_archived: archived,
        secret: "private",
      }),
    },
  ];
  const vectors = Array.from({ length: count }, (_, i) => ({
    id: i + 1,
    docId: "doc-a",
    vectorId: `v${i}`,
  }));
  const chat = {
    id: 7,
    workspaceId: 1,
    prompt: "시험 질문 010-1234-5678",
    createdAt: new Date("2026-10-02"),
    response: JSON.stringify({
      text: "답변",
      sources: [
        {
          id: "v0",
          documentId: "doc-a",
          title: "시험 문서.pdf",
          page: 2,
          text: "저장된 발췌",
        },
        {
          id: "gone",
          documentId: "deleted",
          title: "삭제된 시험 문서",
          text: "과거 발췌",
        },
      ],
    }),
  };
  const reads = [];
  const prisma = {
    workspace_documents: {
      findMany: async (args) => {
        if (broken) throw Error("private detail");
        assert.equal(args.where.workspaceId, 1);
        return docs
          .filter((d) => d.workspaceId === args.where.workspaceId)
          .filter(
            (d) => !args.where.docId || args.where.docId.in.includes(d.docId)
          )
          .filter(
            (d) =>
              !args.where.metadata ||
              d.metadata.includes(args.where.metadata.contains)
          )
          .slice(args.skip || 0, (args.skip || 0) + args.take);
      },
      findFirst: async ({ where }) =>
        docs.find(
          (d) => d.workspaceId === where.workspaceId && d.docId === where.docId
        ) || null,
    },
    document_vectors: {
      findMany: async ({ where, skip = 0, take }) =>
        vectors
          .filter(
            (v) =>
              !where.docId ||
              (typeof where.docId === "string"
                ? v.docId === where.docId
                : where.docId.in.includes(v.docId))
          )
          .filter(
            (v) => !where.vectorId || where.vectorId.in.includes(v.vectorId)
          )
          .slice(skip, skip + take),
    },
    workspace_chats: {
      findMany: async ({ where, take, skip }) => {
        assert.deepEqual(where, { workspaceId: 1, api_session_id: null });
        assert.equal(take, 51);
        assert.equal(skip, 0);
        return [chat];
      },
      findFirst: async ({ where }) =>
        where.workspaceId === chat.workspaceId && where.id === chat.id
          ? chat
          : null,
    },
  };
  const getCollection = async (workspace) => {
    assert.equal(workspace.slug, "test-workspace");
    return {
      get: async (args) => {
        reads.push(args);
        assert.ok(args.ids.length <= 50);
        assert.deepEqual(args.include, ["documents", "metadatas"]);
        return {
          ids: args.ids,
          documents: args.ids.map(
            (id) => `${id} 시험 ${id === "v1" ? "바늘" : "본문"}`
          ),
          metadatas: args.ids.map(() => ({
            page: 2,
            document_version: "명시 버전",
            secret: "private",
          })),
        };
      },
    };
  };
  assert.equal(
    typeof createChunkViewer,
    "function",
    "청크 조회 서비스가 구현되어야 함"
  );
  return {
    viewer: createChunkViewer({
      prisma,
      getCollection,
      provider: () => provider,
    }),
    workspace: { id: 1, slug: "test-workspace" },
    reads,
    docs,
    prisma,
    chat,
    vectors,
  };
}
test("문서 선택은 작업 공간 안의 허용 정보만 반환함", async () => {
  const { viewer, workspace } = fixture();
  const result = await viewer.documents(workspace, {});
  assert.equal(result.items[0].documentId, "doc-a");
  assert.equal(result.items[0].version, null);
  assert.equal(result.items[0].registeredAt, "2026-10-01T00:00:00.000Z");
  assert.equal(JSON.stringify(result).includes("private"), false);
});
test("청크 목록·키워드 검색·페이지 이동은 collection.get만 사용함", async () => {
  const { viewer, workspace, reads } = fixture({ count: 55 });
  const first = await viewer.chunks(workspace, { documentId: "doc-a" });
  assert.equal(first.items.length, 50);
  assert.equal(first.hasMore, true);
  assert.equal(first.nextOffset, 50);
  const second = await viewer.chunks(workspace, {
    documentId: "doc-a",
    offset: "50",
  });
  assert.equal(second.items.length, 5);
  assert.equal(second.hasMore, false);
  const search = await viewer.chunks(workspace, {
    documentId: "doc-a",
    q: "바늘",
  });
  assert.equal(search.items.length, 1);
  assert.equal(search.items[0].id, "v1");
  assert.equal(search.items[0].version, "명시 버전");
  assert.ok(reads.length > 0);
  assert.equal(JSON.stringify(search).includes("private"), false);
});
test("빈 검색·없는 문서·지원하지 않는 공급자·조회 오류를 구분함", async () => {
  const { viewer, workspace } = fixture();
  assert.deepEqual(
    (await viewer.chunks(workspace, { documentId: "doc-a", q: "없는단어" }))
      .items,
    []
  );
  await assert.rejects(
    viewer.chunks(workspace, { documentId: "foreign" }),
    (e) => e.status === 404
  );
  const unsupported = fixture({ provider: "lancedb" });
  await assert.rejects(
    unsupported.viewer.chunks(workspace, { documentId: "doc-a" }),
    (e) => e.status === 422
  );
  const broken = fixture({ broken: true });
  await assert.rejects(
    broken.viewer.documents(workspace, {}),
    /private detail/
  );
});
test("잘못된 검색 조건은 자료 읽기 전에 거부함", async () => {
  const { viewer, workspace, reads } = fixture();
  for (const query of [
    { documentId: "doc-a", q: ["a"] },
    { documentId: "doc-a", q: "x".repeat(201) },
    { documentId: "doc-a", offset: "-1" },
    { documentId: "doc-a", offset: "1e2" },
    { documentId: ["doc-a"] },
  ])
    await assert.rejects(
      viewer.chunks(workspace, query),
      (e) => e.status === 400
    );
  assert.equal(reads.length, 0);
});
test("질문 목록은 식별정보 없이 마스킹하고 다른 공간의 기록은 거부함", async () => {
  const { viewer, workspace } = fixture();
  const list = await viewer.chats(workspace, {});
  assert.equal(list.items[0].question.includes("1234"), false);
  assert.equal(list.items[0].user_id, undefined);
  await assert.rejects(
    viewer.chat({ id: 2, slug: "other" }, "7"),
    (e) => e.status === 404
  );
});
test("저장 발췌와 실제 청크를 구분하고 삭제·불명확 자료를 이전 버전으로 단정하지 않음", async () => {
  const { viewer, workspace } = fixture();
  const detail = await viewer.chat(workspace, "7");
  assert.equal(detail.sources[0].excerpt, "저장된 발췌");
  assert.equal(detail.sources[0].chunk.text, "v0 시험 본문");
  assert.equal(detail.sources[0].status, "current");
  assert.equal(detail.sources[1].status, "unavailable");
  assert.equal(detail.sources[1].chunk, null);
  const archived = fixture({ archived: true });
  assert.equal(
    (await archived.viewer.chat(workspace, "7")).sources[0].status,
    "previous"
  );
});
test("조회 도중 문서 등록정보가 바뀌면 혼합 결과를 성공으로 내보내지 않음", async () => {
  const { prisma, workspace, docs } = fixture();
  const viewer = createChunkViewer({
    prisma,
    provider: () => "chroma",
    getCollection: async () => ({
      get: async ({ ids }) => {
        docs[0] = {
          ...docs[0],
          metadata: '{"schat_document_update_archived":true}',
        };
        return {
          ids,
          documents: ids.map(() => "시험"),
          metadatas: ids.map(() => ({})),
        };
      },
    }),
  });
  await assert.rejects(
    viewer.chunks(workspace, { documentId: "doc-a" }),
    (e) => e.status === 409
  );
});
test("원본 PDF id와 페이지 등록 id가 달라도 정확한 chunk_id로 근거를 연결함", async () => {
  const { viewer, workspace, docs, chat } = fixture();
  docs[0].metadata = JSON.stringify({
    document_id: "original-pdf",
    title: "원본 시험.pdf",
    page: 2,
  });
  chat.response = JSON.stringify({
    sources: [
      {
        chunk_id: "v0",
        document_id: "original-pdf",
        page: 2,
        text: "저장 발췌",
      },
    ],
  });
  const documents = await viewer.documents(workspace, {});
  assert.equal(documents.items[0].name, "원본 시험.pdf");
  assert.equal(documents.items[0].page, 2);
  const detail = await viewer.chat(workspace, "7");
  assert.equal(detail.sources[0].chunk.id, "v0");
  assert.equal(detail.sources[0].documentId, "doc-a");
});
test("정확한 원본ID·페이지의 이전 등록만 이전 버전으로 표시하고 중복은 확인 불가로 남김", async () => {
  const { viewer, workspace, docs, chat } = fixture();
  docs[0].metadata = JSON.stringify({
    document_id: "original-pdf",
    page: 2,
    schat_document_update_archived: true,
  });
  chat.response = JSON.stringify({
    sources: [
      {
        chunk_id: "removed",
        document_id: "original-pdf",
        page: 2,
        text: "과거",
      },
    ],
  });
  assert.equal(
    (await viewer.chat(workspace, "7")).sources[0].status,
    "previous"
  );
  docs.push({ ...docs[0], id: 2, docId: "second-version" });
  assert.equal(
    (await viewer.chat(workspace, "7")).sources[0].status,
    "unavailable"
  );
});
test("다른 작업 공간의 vector id나 같은 파일명은 근거로 연결하지 않음", async () => {
  const { viewer, workspace, docs, chat, vectors } = fixture();
  docs.push({ ...docs[0], workspaceId: 2, docId: "foreign" });
  vectors.push({ id: 10, docId: "foreign", vectorId: "foreign-vector" });
  chat.response = JSON.stringify({
    sources: [
      {
        chunk_id: "foreign-vector",
        document_id: "foreign",
        title: "시험 문서.pdf",
        text: "발췌",
      },
    ],
  });
  const source = (await viewer.chat(workspace, "7")).sources[0];
  assert.equal(source.status, "unavailable");
  assert.equal(source.chunk, null);
  assert.equal(source.documentId, null);
});
test("기본 읽기 어댑터는 실제 Chroma prototype의 연결·이름 정규화만 사용함", async () => {
  const fs = require("node:fs");
  const vm = require("node:vm");
  const path = require("node:path");
  const module = { exports: {} };
  const env = { VECTOR_DB: "chroma" };
  vm.runInNewContext(
    fs.readFileSync(
      path.resolve(__dirname, "../../utils/vectorDbProviders/chroma/index.js"),
      "utf8"
    ),
    {
      module,
      exports: module.exports,
      process: { env },
      console,
      require: (name) => {
        if (name === "chromadb")
          return {
            ChromaClient: class {
              async heartbeat() {
                return true;
              }
              async getCollection({ name }) {
                assert.equal(name, "anythingllm-Test-space");
                return {
                  get: async ({ ids }) => ({
                    ids,
                    documents: ids.map(() => "가짜 연결의 본문"),
                    metadatas: ids.map(() => ({ page: 3 })),
                  }),
                };
              }
              async getOrCreateCollection() {
                throw Error("WRITE_FORBIDDEN");
              }
            },
          };
        if (name === "../base")
          return {
            VectorDatabase: class {
              constructor() {
                throw Error("CONSTRUCTOR_FORBIDDEN");
              }
            },
          };
        if (name === "../../documentUpdates/guard")
          throw Error("UPDATE_DEPENDENCY_FORBIDDEN");
        return {};
      },
    }
  );
  const service = { exports: {} };
  const { prisma } = fixture({ count: 1 });
  vm.runInNewContext(
    fs.readFileSync(
      path.resolve(__dirname, "../../utils/schatAdmin/chunkViewer.js"),
      "utf8"
    ),
    {
      module: service,
      exports: service.exports,
      process: { env },
      console,
      require: (name) => {
        if (name === "./usageStats")
          return require("../../utils/schatAdmin/usageStats");
        if (name === "../vectorDbProviders/chroma") return module.exports;
        if (name === "../prisma") return prisma;
        throw Error(name);
      },
    }
  );
  const data = await service.exports
    .createChunkViewer()
    .chunks({ id: 1, slug: "_Test space" }, { documentId: "doc-a" });
  assert.equal(data.items[0].text, "가짜 연결의 본문");
  assert.equal(data.items[0].page, 3);
});
test("드문 검색어도 한 요청에서 천 개까지만 읽고 다음 위치를 제공함", async () => {
  const { viewer, workspace, reads } = fixture({ count: 1001 });
  const data = await viewer.chunks(workspace, {
    documentId: "doc-a",
    q: "없는 단어",
  });
  assert.equal(data.scanned, 1000);
  assert.equal(data.nextOffset, 1000);
  assert.equal(data.scanLimited, true);
  assert.equal(reads.length, 20);
});
test("실패한 청크 조회는 저장 발췌에 명시 안내하고 불완전한 청크를 현재 원본으로 표시하지 않음", async () => {
  const { prisma, workspace } = fixture();
  const viewer = createChunkViewer({
    prisma,
    provider: () => "chroma",
    getCollection: async () => ({
      get: async ({ ids }) => ({ ids, documents: [], metadatas: [] }),
    }),
  });
  await assert.rejects(viewer.chunks(workspace, { documentId: "doc-a" }));
  const detail = await viewer.chat(workspace, "7");
  assert.equal(detail.sources[0].chunk, null);
  assert.equal(detail.sources[0].status, "unavailable");
  assert.match(detail.notice, /실패/);
});
