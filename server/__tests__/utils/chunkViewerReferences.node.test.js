// 답변 근거 보기: 지침별 보기의 "이 문단을 근거로 쓴 질문"과
// 질문별 보기의 저장 답변 원문 재현. 가짜 DB·가짜 Chroma만 사용한다.
const test = require("node:test");
const assert = require("node:assert/strict");
const { createChunkViewer } = require("../../utils/schatAdmin/chunkViewer");

const DOC = {
  id: 1,
  docId: "doc-a",
  workspaceId: 1,
  filename: "실무지침서.pdf",
  createdAt: new Date("2026-10-01"),
  lastUpdatedAt: new Date("2026-10-01"),
  metadata: JSON.stringify({ title: "실무지침서.pdf", page: 12 }),
};
const CHUNKS = {
  v1: "중심정맥관 드레싱은 투명 드레싱의 경우 7일마다 교환한다.",
  v2: "진정 절차 전 금식 시간을 확인하고 활력징후를 측정한다.",
};
function answer(sources, extra = {}) {
  return JSON.stringify({ text: "**답변**\n\n| 항목 | 값 |\n|---|---|\n| 교환 | 7일 |", sources, ...extra });
}
const CHATS = [
  {
    id: 30,
    prompt: "CVC 드레싱 주기 010-1234-5678",
    createdAt: new Date("2026-10-10"),
    response: answer(
      [
        {
          title: "실무지침서.pdf · p.12",
          documentName: "실무지침서.pdf",
          page: 12,
          excerpt: "중심정맥관 드레싱은 투명 드레싱의 경우 7일마다 교환한다.",
          similarity: 0.81,
        },
      ],
      {
        relatedImages: [{ imageKey: "img-1", caption: "드레싱" }],
        presentation: { kind: "procedure" },
      }
    ),
  },
  {
    id: 31,
    prompt: "진정 금식",
    createdAt: new Date("2026-10-11"),
    response: answer([
      {
        documentName: "실무지침서.pdf",
        page: 12,
        excerpt: "진정 절차 전 금식 시간을 확인하고 활력징후를 측정한다.",
      },
    ]),
  },
  {
    id: 32,
    prompt: "다른 문서 질문",
    createdAt: new Date("2026-10-12"),
    response: answer([
      { documentName: "수술.pdf", page: 12, excerpt: "중심정맥관 드레싱은 투명 드레싱의 경우" },
    ]),
  },
  { id: 33, prompt: "깨진 기록", createdAt: new Date("2026-10-12"), response: "{" },
  {
    id: 34,
    prompt: "본문 없는 과거 기록",
    createdAt: new Date("2026-10-12"),
    response: JSON.stringify({ sources: [] }),
  },
];

function viewer({ chatsFail = false } = {}) {
  const prisma = {
    workspace_documents: {
      findMany: async ({ where, skip = 0, take }) =>
        [DOC]
          .filter((d) => d.workspaceId === where.workspaceId)
          .filter((d) => !where.docId || where.docId.in.includes(d.docId))
          .slice(skip, skip + take),
      findFirst: async ({ where }) =>
        where.docId === DOC.docId && where.workspaceId === 1 ? DOC : null,
    },
    document_vectors: {
      findMany: async ({ where }) =>
        Object.keys(CHUNKS)
          .map((vectorId, i) => ({ id: i + 1, docId: "doc-a", vectorId }))
          .filter((v) => !where.vectorId || where.vectorId.in.includes(v.vectorId)),
    },
    workspace_chats: {
      findMany: async ({ where, take }) => {
        if (chatsFail) throw new Error("db down");
        assert.deepEqual(where, { workspaceId: 1, api_session_id: null });
        assert.ok(take <= 3000);
        return CHATS;
      },
      findFirst: async ({ where }) => CHATS.find((c) => c.id === where.id) || null,
    },
  };
  const getCollection = async () => ({
    get: async ({ ids }) => ({
      ids,
      documents: ids.map((id) => CHUNKS[id]),
      metadatas: ids.map(() => ({ page: 12, section: "중심정맥관 관리" })),
    }),
  });
  return createChunkViewer({ prisma, getCollection, provider: () => "chroma" });
}
const WS = { id: 1, slug: "ws" };

test("근거 문단마다 그 문단을 쓴 질문만 연결하고 질문의 긴 숫자는 가린다", async () => {
  const result = await viewer().chunks(WS, { documentId: "doc-a", offset: "0" });
  const [cvc, sedation] = result.items;
  assert.equal(cvc.references.count, 1);
  assert.equal(cvc.references.items[0].id, 30);
  assert.equal(cvc.references.items[0].similarity, 0.81);
  assert.equal(cvc.references.items[0].score, null);
  assert.doesNotMatch(cvc.references.items[0].question, /1234-5678/);
  assert.equal(sedation.references.count, 1);
  assert.equal(sedation.references.items[0].id, 31);
  // 다른 문서(수술.pdf)의 같은 쪽 기록은 연결하지 않는다.
  assert.ok(!cvc.references.items.some((item) => item.id === 32));
  assert.equal(result.document.referenceCount, 2);
});

test("문서 목록에 참조 질문 수를 함께 준다", async () => {
  const result = await viewer().documents(WS, { offset: "0" });
  assert.equal(result.items[0].referenceCount, 2);
});

test("질문 기록을 읽지 못해도 문단 조회는 그대로 된다", async () => {
  const result = await viewer({ chatsFail: true }).chunks(WS, { documentId: "doc-a", offset: "0" });
  assert.equal(result.items.length, 2);
  assert.equal(result.items[0].references, undefined);
});

test("질문별 보기는 저장된 답변 본문·출처·그림을 고치지 않고 돌려준다", async () => {
  const detail = await viewer().chat(WS, "30");
  assert.equal(detail.answer.available, true);
  assert.equal(detail.answer.text, JSON.parse(CHATS[0].response).text);
  assert.equal(detail.answer.sources[0].excerpt, CHUNKS.v1);
  assert.deepEqual(detail.answer.relatedImages, [{ imageKey: "img-1", caption: "드레싱" }]);
  assert.deepEqual(detail.answer.presentation, { kind: "procedure" });
  assert.deepEqual(detail.answer.missing, []);
  assert.equal(detail.sources[0].similarity, 0.81);
  assert.equal(detail.sources[0].score, null);
});

test("본문이 저장되지 않은 과거 기록은 없는 내용을 만들지 않고 빠진 항목을 알린다", async () => {
  const detail = await viewer().chat(WS, "34");
  assert.equal(detail.answer.available, false);
  assert.equal(detail.answer.text, "");
  assert.deepEqual(detail.answer.missing, ["답변 본문"]);
});
