// 2026-10-17 질문·답변 기록: 질문한 직원은 부서·사번만 보여 주고(이름 없음),
// 통계에서 누른 조건(문서·주제·검색 실패·근거 없음)으로 질문을 고른다. 가상 자료만 쓴다.
const test = require("node:test");
const assert = require("node:assert/strict");
const { createChunkViewer } = require("../../utils/schatAdmin/chunkViewer");

const user = { employee_number: "20152", display_name: "보이면 안 되는 이름", department: { name: "92병동" } };
const at = (day) => new Date(`${day}T03:00:00Z`);
const chats = [
  { id: 5, prompt: "가상 실패 질문", createdAt: at("2026-10-16"), users: user, response: JSON.stringify({ text: "등록된 문서에서 확인되지 않습니다.", sources: [] }) },
  { id: 4, prompt: "가상 근거 없음", createdAt: at("2026-10-15"), users: null, response: JSON.stringify({ text: "등록된 문서에서 확인되지 않습니다.", sources: [{ title: "가상 지침.pdf", page: 3 }] }) },
  { id: 3, prompt: "가상 정상 질문", createdAt: at("2026-10-14"), users: user, response: JSON.stringify({ text: "답", sources: [{ title: "가상 지침.pdf", page: 7, section: "가상 목차" }] }) },
  { id: 2, prompt: "기간 밖 질문", createdAt: at("2026-09-01"), users: user, response: JSON.stringify({ text: "답", sources: [{ title: "가상 지침.pdf", page: 7 }] }) },
];

function viewer() {
  const calls = [];
  const prisma = {
    workspace_chats: {
      findMany: async (args) => {
        calls.push(args);
        const { gte, lt } = args.where.createdAt || {};
        return chats
          .filter((c) => (!gte || c.createdAt >= gte) && (!lt || c.createdAt < lt))
          .slice(args.skip || 0, (args.skip || 0) + args.take);
      },
      findFirst: async ({ where }) => chats.find((c) => c.id === where.id) || null,
    },
    workspace_documents: { findFirst: async () => null, findMany: async () => [] },
    document_vectors: { findMany: async () => [] },
  };
  return { calls, viewer: createChunkViewer({ prisma, provider: () => "lancedb" }) };
}
const workspace = { id: 1, slug: "ws" };
const range = { startDate: "2026-10-11", endDate: "2026-10-17" };

test("질문 목록과 답변 상세에는 부서·사번만 있고 이름은 없다", async () => {
  const { viewer: v, calls } = viewer();
  const list = await v.chats(workspace, {});
  assert.deepEqual(calls[0].select.users, {
    select: { employee_number: true, department: { select: { name: true } } },
  });
  assert.equal(list.items[0].department, "92병동");
  assert.equal(list.items[0].employeeNumber, "20152");
  assert.equal(list.items[1].department, null);
  assert.doesNotMatch(JSON.stringify(list), /보이면 안 되는 이름|display_name/);
  const detail = await v.chat(workspace, "5");
  assert.equal(detail.employeeNumber, "20152");
  assert.doesNotMatch(JSON.stringify(detail), /보이면 안 되는 이름/);
});

test("통계 조건으로 검색 실패·근거 없음·문서·주제 질문만 고르고 기간 밖은 뺀다", async () => {
  const { viewer: v } = viewer();
  const ids = async (query) => (await v.chats(workspace, { ...range, ...query })).items.map((c) => c.id);
  assert.deepEqual(await ids({ kind: "fail" }), [5]);
  assert.deepEqual(await ids({ kind: "notfound" }), [4]);
  assert.deepEqual(await ids({ document: "가상 지침.pdf" }), [4, 3]);
  assert.deepEqual(await ids({ topic: "가상 지침.pdf · 가상 목차" }), [3]);
  const result = await v.chats(workspace, { ...range, document: "가상 지침.pdf" });
  assert.equal(result.total, 2);
});

test("이상한 조건 값은 무시하거나 400으로 거부한다", async () => {
  const { viewer: v, calls } = viewer();
  await v.chats(workspace, { kind: "everyone" });
  assert.equal(calls[0].where.createdAt, undefined); // 조건 없음 → 전체 목록
  await assert.rejects(v.chats(workspace, { kind: "fail", startDate: "어제", endDate: "오늘" }), (e) => e.status === 400);
  await assert.rejects(v.chats(workspace, { kind: "fail", ...range, departmentIds: "1;drop" }), (e) => e.status === 400);
});
