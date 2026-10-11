import test from "node:test";
import assert from "node:assert/strict";
import * as review from "./synonymReview.js";

const groups = [
  {
    id: 1,
    terms: ["관", "tube"],
    kind: "procedure",
    source: "admin",
    status: "active",
    pendingAdditions: [
      {
        id: 11,
        terms: ["catheter"],
        status: "pending",
        sources: [{ documentName: "가짜지침.pdf", pages: [3] }],
      },
    ],
  },
  {
    id: 2,
    terms: ["생검", "biopsy"],
    kind: "procedure",
    source: "auto",
    status: "needs_review",
    suggestion: {
      id: 12,
      status: "pending",
      sources: [{ documentName: "가짜지침.pdf", pages: [2] }],
    },
  },
  {
    id: 3,
    terms: ["약", "drug"],
    kind: "drug",
    source: "draft",
    status: "needs_review",
  },
  {
    id: 4,
    terms: ["흉관", "chest tube"],
    kind: "procedure",
    source: "auto",
    status: "off",
    suggestion: { id: 13, status: "approved" },
  },
];

test("표 상태는 추가 제안이 있는 사용 중 묶음을 검토 대기로 중복 분류하지 않으며 꺼진 기록도 유지한다", () => {
  const view = review.synonymTableView(groups);
  assert.deepEqual(view.counts, { all: 4, needs_review: 2, active: 1, off: 1 });
  assert.deepEqual(
    view.sections.map((section) => section.groups.map((group) => group.id)),
    [[2, 3], [1], [4]]
  );
});

test("거절한 AI 새 묶음 기록은 다시 제안하지 않기 위해 남기되 표와 개수에서는 숨긴다", () => {
  const rejected = {
    ...groups[3],
    id: 5,
    suggestion: {
      id: 14,
      status: "dismissed",
      sources: [{ documentName: "제외문서.pdf" }],
    },
  };
  const view = review.synonymTableView([...groups, rejected]);
  assert.equal(view.total, 4);
  assert.equal(view.counts.off, 1);
  assert.equal(
    view.rows.some((group) => group.id === 5),
    false
  );
  assert.equal(view.documents.includes("제외문서.pdf"), false);
});

test("단어·분류·문서·상태 조건을 함께 적용한다", () => {
  const view = review.synonymTableView(groups, {
    query: "BIO",
    kind: "procedure",
    document: "가짜지침.pdf",
    status: "needs_review",
  });
  assert.deepEqual(
    view.rows.map((group) => group.id),
    [2]
  );
  assert.deepEqual(
    review
      .synonymTableView(groups, { query: "catheter", status: "active" })
      .rows.map((group) => group.id),
    [1]
  );
  assert.equal(
    review.synonymTableView(groups, { kind: "drug", document: "가짜지침.pdf" })
      .total,
    0
  );
});

test("20개씩 표시하며 마지막 페이지와 빈 결과의 페이지 범위를 보정한다", () => {
  const many = Array.from({ length: 43 }, (_, index) => ({
    ...groups[0],
    id: index + 1,
  }));
  const first = review.synonymTableView(many);
  assert.equal(first.rows.length, 20);
  assert.deepEqual(
    [first.start, first.end, first.total, first.pages],
    [1, 20, 43, 3]
  );
  const last = review.synonymTableView(many, { page: 99 });
  assert.deepEqual(
    last.rows.map((group) => group.id),
    [41, 42, 43]
  );
  assert.deepEqual([last.page, last.start, last.end], [3, 41, 43]);
  const empty = review.synonymTableView(groups, { query: "없는말", page: 9 });
  assert.deepEqual(
    [empty.page, empty.start, empty.end, empty.pages],
    [1, 0, 0, 1]
  );
});

test("선택 등록은 검토 대기에만 적용하고 기존 승인 API 또는 수동 초안 상태 변경을 사용한다", async () => {
  const calls = [];
  const api = {
    approveAddition: async (id) => {
      calls.push(["approve", id]);
      return { ok: true, success: true };
    },
    update: async (id, change) => {
      calls.push(["update", id, change]);
      return { ok: true, success: true };
    },
  };
  const result = await review.reviewSelectedGroups(
    groups,
    [1, 2, 3, 4],
    true,
    api
  );
  assert.deepEqual(calls, [
    ["approve", 12],
    ["update", 3, { status: "active" }],
  ]);
  assert.deepEqual(result.completed, [2, 3]);
  assert.deepEqual(result.failed, []);
});

test("선택 제외는 제안 거절 기록을 보존하고 서버 실패를 개별 안내한다", async () => {
  const calls = [];
  const api = {
    dismissAddition: async (id) => {
      calls.push(id);
      return { ok: false, error: "가짜 실패" };
    },
    update: async () => ({ ok: true, success: true }),
  };
  const result = await review.reviewSelectedGroups(groups, [2, 3], false, api);
  assert.deepEqual(calls, [12]);
  assert.deepEqual(result.completed, [3]);
  assert.deepEqual(result.failed, [{ id: 2, error: "가짜 실패" }]);
});

test("최소 두 단어·대소문자 중복·다른 묶음 중복·의미 반대 검증은 승인 직전에도 적용한다", async () => {
  const invalid = [
    { ...groups[1], terms: ["one"] },
    { ...groups[1], terms: [" A ", "a"] },
    { ...groups[1], terms: ["tube", "new"] },
    { ...groups[1], terms: ["관 삽입", "tube removal"] },
  ];
  for (const group of invalid) {
    const result = await review.reviewSelectedGroups(
      [groups[0], group],
      [2],
      true,
      {
        approveAddition() {
          assert.fail("잘못된 묶음은 서버 승인 요청을 보내면 안 됨");
        },
      }
    );
    assert.equal(result.failed.length, 1);
  }
});

test("편집 저장은 사용 안 함 상태를 보존하고 검토 대기 제안은 저장 성공 뒤 승인한다", async () => {
  const calls = [];
  const api = {
    update: async (id, change) => {
      calls.push(["update", id, change]);
      return { ok: true, success: true };
    },
    approveAddition: async (id) => {
      calls.push(["approve", id]);
      return { ok: true, success: true };
    },
  };
  await review.saveSynonymGroup(
    groups[3],
    [" 흉관 ", "thoracic tube"],
    "procedure",
    "off",
    api
  );
  assert.deepEqual(calls[0], [
    "update",
    4,
    { terms: ["흉관", "thoracic tube"], kind: "procedure", status: "off" },
  ]);
  await review.saveSynonymGroup(
    groups[1],
    ["생검", "tissue biopsy"],
    "procedure",
    "off",
    api
  );
  assert.deepEqual(calls[1], [
    "update",
    2,
    { terms: ["생검", "tissue biopsy"], kind: "procedure" },
  ]);
  assert.deepEqual(calls[2], ["approve", 12]);
});

test("편집 저장 후 승인 실패는 저장된 변경이 남아 있음을 숨기지 않는다", async () => {
  const result = await review.saveSynonymGroup(
    groups[1],
    ["생검", "biopsy"],
    "procedure",
    "off",
    {
      update: async () => ({ ok: true, success: true }),
      approveAddition: async () => ({ ok: false, error: "승인 연결 실패" }),
    }
  );
  assert.equal(result.success, false);
  assert.match(result.error, /수정 내용은 저장.*등록.*실패/);
});

test("첫 저장이 실패하면 승인하지 않고 연결 실패가 나도 저장된 수정은 구분한다", async () => {
  const rejected = await review.saveSynonymGroup(
    groups[1],
    ["생검", "biopsy"],
    "procedure",
    "off",
    {
      update: async () => ({ ok: false, success: false, error: "저장 실패" }),
      approveAddition: () => assert.fail("저장 실패 뒤 승인하면 안 됨"),
    }
  );
  assert.equal(rejected.error, "저장 실패");
  const partial = await review.saveSynonymGroup(
    groups[1],
    ["생검", "biopsy"],
    "procedure",
    "off",
    {
      update: async () => ({ ok: true, success: true }),
      approveAddition: async () => {
        throw new Error("가짜 연결 실패");
      },
    }
  );
  assert.match(partial.error, /수정 내용은 저장.*등록.*실패/);
});

test("선택 처리 중 한 요청의 연결 실패가 나도 다른 검토 대기 묶음 결과를 재확인할 수 있다", async () => {
  const result = await review.reviewSelectedGroups(groups, [2, 3], true, {
    approveAddition: async () => {
      throw new Error("가짜 연결 실패");
    },
    update: async () => ({ ok: true, success: true }),
  });
  assert.deepEqual(result.completed, [3]);
  assert.deepEqual(result.failed, [
    { id: 2, error: "서버에 연결하지 못했어요." },
  ]);
});
