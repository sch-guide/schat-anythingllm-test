const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const fs = require("node:fs");
const path = require("node:path");
function load(file, deps) {
  const module = { exports: {} };
  const filename = path.resolve(__dirname, "../..", file);
  if (!fs.existsSync(filename)) return {};
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
function setup(role = "admin", failure = false) {
  const user = { id: 1, role, suspended: false, must_change_password: false };
  const system = { SystemSettings: { isMultiUserMode: async () => true } };
  const http = {
    decodeJWT: (token) => (token === "test" ? { id: 1 } : null),
    userFromSession: async (_, res) => res.locals.user,
  };
  const auth = load("utils/middleware/validatedRequest.js", {
    "../../models/systemSettings": system,
    "../../models/user": { User: { get: async () => user } },
    "../EncryptionManager": { EncryptionManager: class {} },
    "../http": http,
    "../userLocale": { UserMetaCache: { setFromRequest() {} } },
  });
  const roles = load("utils/middleware/multiUserProtected.js", {
    "../../models/systemSettings": system,
    "../http": http,
  });
  const routes = new Map();
  const calls = [];
  const viewer = Object.fromEntries(
    ["documents", "chunks", "chats", "chat"].map((method) => [
      method,
      async (workspace, arg) => {
        calls.push({ method, workspace, arg });
        if (failure) throw Error("private detail");
        return { items: [], hasMore: false };
      },
    ])
  );
  const endpoint = load("endpoints/chunkViewer.js", {
    "../models/workspace": {
      Workspace: {
        getWithUser: async (_, { id }) =>
          id === 1 ? { id, slug: "test" } : null,
        get: async () => null,
      },
    },
    "../utils/middleware/validatedRequest": auth,
    "../utils/middleware/multiUserProtected": roles,
    "../utils/schatAdmin/chunkViewer": { createChunkViewer: () => viewer },
  });
  endpoint.chunkViewerEndpoints?.({
    get: (route, ...handlers) => routes.set(route, handlers.flat()),
  });
  return {
    calls,
    routes,
    async invoke(route, query = { workspaceId: "1" }, token = "test") {
      const handlers = routes.get(route);
      assert.ok(handlers, "읽기 전용 조회 경로가 등록되어야 함");
      const req = {
        query,
        params: { id: "7" },
        header: (name) =>
          name.toLowerCase() === "authorization"
            ? `Bearer ${token}`
            : undefined,
      };
      const res = {
        locals: {},
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
        sendStatus(v) {
          this.statusCode = v;
          return this;
        },
        end() {
          return this;
        },
        json(data) {
          this.data = data;
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
const paths = [
  "/schat-admin/chunk-documents",
  "/schat-admin/chunks",
  "/schat-admin/chunk-chats",
  "/schat-admin/chunk-chats/:id",
];
test("직원·manager·잘못된 인증은 모든 조회 경로에서 차단함", async () => {
  for (const role of ["default", "manager"]) {
    const app = setup(role);
    for (const route of paths)
      assert.equal((await app.invoke(route)).statusCode, 401);
    assert.equal(app.calls.length, 0);
  }
  assert.equal(
    (await setup().invoke(paths[0], undefined, "bad")).statusCode,
    401
  );
});
test("선택 공간을 서버에서 확인하고 범위없는 요청은 거부함", async () => {
  const app = setup();
  for (const workspaceId of ["", ["1"], "1e0", "-1"])
    assert.equal((await app.invoke(paths[0], { workspaceId })).statusCode, 400);
  assert.equal(
    (await app.invoke(paths[0], { workspaceId: "2" })).statusCode,
    404
  );
  assert.equal(app.calls.length, 0);
  for (const route of paths) {
    const result = await app.invoke(route);
    assert.equal(result.statusCode, 200);
    assert.equal(result.headers["Cache-Control"], "no-store");
  }
  assert.equal(app.calls[3].workspace.id, 1);
  assert.equal(app.calls[3].arg, "7");
});
test("조회 실패는 빈 성공으로 바꾸거나 내부 오류를 드러내지 않음", async () => {
  const result = await setup("admin", true).invoke(paths[0]);
  assert.equal(result.statusCode, 503);
  assert.equal(result.data.items, undefined);
  assert.equal(JSON.stringify(result.data).includes("private detail"), false);
});
