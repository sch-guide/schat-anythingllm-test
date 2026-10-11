const test = require("node:test");
const assert = require("node:assert/strict");
const api = (() => {
  try {
    return require("../../endpoints/answerFeedback");
  } catch {
    return {};
  }
})();
function response() {
  return {
    locals: { workspace: { id: 2 } },
    statusCode: 200,
    headers: {},
    set(k, v) {
      this.headers[k] = v;
      return this;
    },
    status(v) {
      this.statusCode = v;
      return this;
    },
    json(v) {
      this.body = v;
      return this;
    },
  };
}
test("평가 저장 요청은 로그인 사용자와 workspace를 전달하고 비로그인을 차단", async () => {
  assert.equal(typeof api.feedbackSaveHandler, "function");
  let calls = 0;
  const store = {
    save: async (user, workspace, chat, input) => {
      calls++;
      assert.deepEqual(
        [user, workspace, chat, input],
        [7, 2, 11, { feedback: false, reason: "wrong" }]
      );
      return { feedback: false };
    },
  };
  const make = (user) =>
    api.feedbackSaveHandler({
      getUser: async () => user,
      getBody: (r) => r.body,
      getStore: () => store,
    });
  const request = {
    params: { chatId: "11" },
    body: { feedback: false, reason: "wrong" },
  };
  const res = response();
  await make({ id: 7 })(request, res);
  assert.equal(res.body.success, true);
  assert.equal(res.headers["Cache-Control"], "no-store");
  const denied = response();
  await make(null)(request, denied);
  assert.equal(denied.statusCode, 401);
  assert.equal(calls, 1);
});
test("저장·관리자 오류 응답과 로그는 메모·driver오류를 포함하지 않음", async () => {
  assert.equal(typeof api.safeFeedbackHandler, "function");
  const messages = [];
  const before = console.error;
  console.error = (...args) => messages.push(args.join(" "));
  try {
    const res = response();
    await api.safeFeedbackHandler(async () => {
      throw new Error("김민지님 12345678 비공개 입력");
    })({}, res);
    assert.equal(res.statusCode, 503);
    assert.deepEqual(res.body, {
      success: false,
      code: "UNAVAILABLE",
      error: "평가를 처리하지 못했습니다. 다시 시도해 주세요.",
    });
    assert.deepEqual(messages, ["[answer-feedback] UNAVAILABLE"]);
  } finally {
    console.error = before;
  }
});
test("관리자 목록·상세·완료 경로 모두 adminOnly 사용, 신고와 평가의 같은 id를 구분", async () => {
  assert.equal(typeof api.registerFeedbackAdminEndpoints, "function");
  const routes = [];
  const adminOnly = [() => {}];
  const app = {
    get: (...args) => routes.push(["GET", ...args]),
    patch: (...args) => routes.push(["PATCH", ...args]),
  };
  const row = {
    id: 1,
    kind: "wrong",
    question: "합성 질문",
    createdAt: "2026-10-12",
  };
  api.registerFeedbackAdminEndpoints(app, {
    adminOnly,
    listReports: async () => [
      { id: 1, title: "기존 신고", createdAt: "2026-10-11" },
    ],
    getStore: () => ({
      list: async () => [row],
      detail: async () => ({ ...row, answer: "전체 답변", sources: [] }),
      resolve: async () => ({ ...row, status: "resolved" }),
    }),
  });
  assert.equal(routes.length, 3);
  for (const route of routes) assert.equal(route[2], adminOnly);
  const res = response();
  await routes[0][3]({ query: {} }, res);
  assert.deepEqual(
    res.body.reports.map((r) => [r.id, r.kind]),
    [
      [1, "wrong"],
      [1, "report"],
    ]
  );
  const filtered = response();
  await routes[0][3]({ query: { kind: "wrong" } }, filtered);
  assert.equal(filtered.body.reports.length, 1);
  const detail = response();
  await routes[1][3]({ params: { id: 1 } }, detail);
  assert.equal(detail.body.feedback.answer, "전체 답변");
  const done = response();
  await routes[2][3]({ params: { id: 1 } }, done);
  assert.equal(done.body.feedback.status, "resolved");
});
