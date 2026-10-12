const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const fs = require("node:fs");
const path = require("node:path");
const { createAnswerCache } = require("../../utils/answerCache");

function load(file, deps) {
  const module = { exports: {} };
  const filename = path.resolve(__dirname, "../..", file);
  if (!fs.existsSync(filename)) return module.exports;
  vm.runInNewContext(fs.readFileSync(filename, "utf8"), {
    module,
    exports: module.exports,
    process: { env: { NODE_ENV: "production" } },
    console,
    require: (name) => {
      if (name in deps) return deps[name];
      throw Error(name);
    },
  });
  return module.exports;
}
function setup(role = "admin", failWorkspace = false) {
  const user = { id: 1, role, suspended: false, must_change_password: false };
  const system = { SystemSettings: { isMultiUserMode: async () => true } };
  const http = {
    decodeJWT: (token) => (token === "test" ? { id: 1 } : null),
    userFromSession: async (_, res) => res.locals.user,
  };
  const auth = load("utils/middleware/validatedRequest.js", {
    "../../models/systemSettings": system,
    "../../models/user": { User: { get: async () => user } },
    // 이 검사는 다른 기능 대상: 개인정보 동의는 이미 한 것으로 둔다.
    "../privacyConsent": { exemptPath: () => false, hasCurrentConsent: async () => true },
    "../EncryptionManager": { EncryptionManager: class {} },
    "../http": http,
    "../userLocale": { UserMetaCache: { setFromRequest() {} } },
  });
  const roles = load("utils/middleware/multiUserProtected.js", {
    "../../models/systemSettings": system,
    "../http": http,
  });
  const cache = createAnswerCache({ now: () => 1728000000000 });
  for (const workspaceId of [1, 2])
    cache.put({
      workspaceId,
      question: `안전한 시험 질문 ${workspaceId}`,
      generation: cache.generation(workspaceId),
      value: { answer: "비공개 시험 답변", sources: [] },
    });
  cache.get(2, "안전한 시험 질문 2");
  const routes = new Map();
  const endpoint = load("endpoints/answerCache.js", {
    "../utils/middleware/validatedRequest": auth,
    "../utils/middleware/multiUserProtected": roles,
    "../utils/answerCacheRuntime": { cache },
    "../models/workspace": {
      Workspace: {
        get: async ({ id }) => {
          if (failWorkspace) throw Error("private DB detail");
          return [1, 2].includes(id) ? { id } : null;
        },
        getWithUser: async (user, { id }) => {
          assert.equal(user.role, "admin");
          if (failWorkspace) throw Error("private DB detail");
          return [1, 2].includes(id) ? { id } : null;
        },
      },
    },
  });
  endpoint.answerCacheEndpoints?.(
    Object.fromEntries(
      ["get", "delete", "post"].map((method) => [
        method,
        (route, ...handlers) =>
          routes.set(`${method} ${route}`, handlers.flat()),
      ]),
    ),
  );
  return {
    cache,
    async invoke(
      method,
      route = "/schat-admin/answer-cache",
      { workspaceId = "1", id, body, token = "test" } = {},
    ) {
      const handlers = routes.get(`${method} ${route}`);
      assert.ok(handlers, "캐시 관리자 경로가 등록되어야 함");
      const req = {
        query: { workspaceId },
        params: { id },
        body,
        header: (name) =>
          name.toLowerCase() === "authorization"
            ? `Bearer ${token}`
            : undefined,
      };
      const res = {
        locals: {},
        statusCode: 200,
        headers: {},
        set(name, value) {
          this.headers[name] = value;
          return this;
        },
        status(value) {
          this.statusCode = value;
          return this;
        },
        sendStatus(value) {
          this.statusCode = value;
          return this;
        },
        end() {
          return this;
        },
        json(value) {
          this.data = value;
          return this;
        },
      };
      for (const handler of handlers) {
        let next = false;
        await handler(req, res, () => {
          next = true;
        });
        if (!next) break;
      }
      return res;
    },
  };
}
test("직원과 잘못된 인증은 캐시 조회와 삭제에 접근하지 못함", async () => {
  for (const role of ["default", "manager"]) {
    const app = setup(role);
    for (const [method, route] of [
      ["get", "/schat-admin/answer-cache"],
      ["delete", "/schat-admin/answer-cache/:id"],
      ["post", "/schat-admin/answer-cache/clear"],
    ]) {
      assert.equal(
        (await app.invoke(method, route, { id: "1", body: { confirm: true } }))
          .statusCode,
        401,
      );
    }
    assert.equal(app.cache.stats().entries, 2);
  }
  assert.equal(
    (await setup().invoke("get", undefined, { token: "bad" })).statusCode,
    401,
  );
});
test("목록은 선택 작업 공간 메타정보만 반환하고 전역 절약 누계를 구분함", async () => {
  const res = await setup().invoke("get");
  assert.equal(res.headers["Cache-Control"], "no-store");
  assert.equal(res.data.entries.length, 1);
  assert.deepEqual(Object.keys(res.data.entries[0]).sort(), [
    "createdAt",
    "id",
    "question",
    "uses",
    "workspaceId",
  ]);
  assert.equal(res.data.entries[0].workspaceId, 1);
  assert.equal(res.data.entries[0].uses, 0);
  assert.equal(res.data.stats.savedAnswerCalls, 1);
  assert.equal(res.data.stats.scope, "all-workspaces-since-start");
  assert.equal(JSON.stringify(res.data).includes("비공개 시험 답변"), false);
});
test("잘못되거나 없는 작업 공간은 조회와 개별 삭제가 거부됨", async () => {
  const app = setup();
  for (const [workspaceId, status] of [
    ["", 400],
    ["1e0", 400],
    ["-1", 400],
    ["999", 404],
    [["1", "2"], 400],
  ]) {
    assert.equal(
      (await app.invoke("get", undefined, { workspaceId })).statusCode,
      status,
    );
    assert.equal(
      (
        await app.invoke("delete", "/schat-admin/answer-cache/:id", {
          workspaceId,
          id: "1",
        })
      ).statusCode,
      status,
    );
  }
  assert.equal(app.cache.stats().entries, 2);
});
test("다른 공간의 항목 삭제는 거부하고 자신의 항목만 지움", async () => {
  const app = setup();
  assert.equal(
    (await app.invoke("delete", "/schat-admin/answer-cache/:id", { id: "2" }))
      .statusCode,
    404,
  );
  assert.equal(app.cache.list(2).length, 1);
  assert.equal(
    (await app.invoke("delete", "/schat-admin/answer-cache/:id", { id: "1" }))
      .statusCode,
    200,
  );
  assert.equal(app.cache.list(1).length, 0);
  assert.equal(app.cache.list(2).length, 1);
});
test("전체 비우기는 명시 확인을 요구하고 누계는 보존함", async () => {
  const app = setup();
  assert.equal(
    (
      await app.invoke("post", "/schat-admin/answer-cache/clear", {
        body: { confirm: "true" },
      })
    ).statusCode,
    400,
  );
  assert.equal(app.cache.stats().entries, 2);
  const res = await app.invoke("post", "/schat-admin/answer-cache/clear", {
    body: { confirm: true },
  });
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers["Cache-Control"], "no-store");
  assert.equal(app.cache.stats().entries, 0);
  assert.equal(app.cache.stats().hits, 1);
});
test("조회 실패는 0건 성공 응답으로 바뀌지 않고 내부 오류를 노출하지 않음", async () => {
  const res = await setup("admin", true).invoke("get");
  assert.equal(res.statusCode, 503);
  assert.equal(res.data.entries, undefined);
  assert.equal(JSON.stringify(res.data).includes("private DB detail"), false);
});
