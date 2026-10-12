const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const fs = require("node:fs");
const path = require("node:path");
const { createRuntime } = require("../../utils/chatAdmissionRuntime");
function load(file, deps) {
  const module = { exports: {} };
  vm.runInNewContext(
    fs.readFileSync(path.resolve(__dirname, "../..", file), "utf8"),
    {
      module,
      exports: module.exports,
      console,
      process: { env: { NODE_ENV: "production" } },
      require: (name) => {
        if (name in deps) return deps[name];
        throw Error(name);
      },
    }
  );
  return module.exports;
}
function setup(role) {
  const user = { id: 1, role, suspended: false, must_change_password: false };
  const system = { SystemSettings: { isMultiUserMode: async () => true } };
  const http = {
    decodeJWT: (token) => (token === "test" ? { id: 1 } : null),
    userFromSession: async (_, res) => res.locals.user,
    multiUserMode: (res) => res.locals.multiUserMode,
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
  let saved = null;
  const runtime = createRuntime({
    read: async () => saved,
    write: async (value) => {
      saved = value;
    },
  });
  const routes = {};
  load("endpoints/chatAdmission.js", {
    "../utils/middleware/validatedRequest": auth,
    "../utils/middleware/multiUserProtected": roles,
    "../utils/chatAdmissionRuntime": { runtime },
    "../utils/geminiDailyUsage": { dailyUsage: {snapshot: async model => ({model, count: 7000, limit: 10000, warning: true})} },
  }).chatAdmissionEndpoints({
    get: (p, ...handlers) => (routes.GET = handlers.flat()),
    put: (p, ...handlers) => (routes.PUT = handlers.flat()),
  });
  return {
    runtime,
    invoke: async (method, body, token = "test") => {
      const req = {
        headers: { authorization: `Bearer ${token}` },
        header: (name) =>
          name.toLowerCase() === "authorization"
            ? `Bearer ${token}`
            : undefined,
        body,
      };
      const res = {
        locals: {},
        statusCode: 200,
        end() {
          return this;
        },
        set() {
          return this;
        },
        status(code) {
          this.statusCode = code;
          return this;
        },
        sendStatus(code) {
          this.statusCode = code;
          return this;
        },
        json(data) {
          this.data = data;
          return this;
        },
      };
      for (const handler of routes[method]) {
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
test("employee cannot inspect or change shared admission policy", async () => {
  const app = setup("default");
  assert.equal((await app.invoke("GET")).statusCode, 401);
  assert.equal((await app.invoke("PUT", { maxActive: 8 })).statusCode, 401);
  assert.equal((await app.runtime.ready()).snapshot().maxActive, 4);
});
test("admin saves validated limit and reads current active count without identities", async () => {
  const app = setup("admin");
  assert.equal((await app.invoke("PUT", { maxActive: 0 })).statusCode, 400);
  assert.equal((await app.invoke("PUT", { maxActive: 3 })).statusCode, 200);
  const lease = await (await app.runtime.ready()).acquire("private-user");
  const res = await app.invoke("GET");
  assert.equal(res.data.active, 1);
  assert.equal(res.data.maxActive, 3);
  assert.equal(res.data.dailyUsage.count, 7000);
  assert.equal(res.data.dailyUsage.warning, true);
  assert.equal(JSON.stringify(res.data).includes("private-user"), false);
  lease.release();
});
