const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

// Exercise the registered authorization chain, not a substitute role check.
function setup(role = "admin") {
  const root = path.resolve(__dirname, "../../..");
  function load(file, deps) {
    const module = { exports: {} };
    vm.runInNewContext(fs.readFileSync(path.join(root, file), "utf8"), {
      module,
      exports: module.exports,
      console,
      process: { env: { NODE_ENV: "production" } },
      require(name) {
        if (name in deps) return deps[name];
        throw new Error(`Unexpected dependency: ${name}`);
      },
    });
    return module.exports;
  }
  const user = { id: 1, role, suspended: false, must_change_password: false };
  const http = {
    decodeJWT: (token) => (token === "synthetic" ? { id: 1 } : null),
    userFromSession: async (_, res) => res.locals.user,
    multiUserMode: (res) => res.locals.multiUserMode,
  };
  const system = { SystemSettings: { isMultiUserMode: async () => true } };
  const validated = load("utils/middleware/validatedRequest.js", {
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
  let calls = 0;
  const deps = {
    "../utils/synonyms/questionCandidateService": {
      questionSettings: async () => { calls++; return {limit:20,calls:0,status:"idle",disabled:false}; },
      saveQuestionLimit: async (limit) => { calls++; if(!Number.isInteger(limit)||limit<0||limit>200) throw Error("PRIVATE DRIVER ERROR"); return {limit}; },
    },
    "node:crypto": require("node:crypto"),
    "../utils/middleware/validatedRequest": validated,
    "../utils/middleware/multiUserProtected": roles,
    "../utils/synonyms/suggestions": {
      approveVisible: async (ids) => {
        calls++;
        return { approved: ids, failed: [], skipped: [] };
      },
      listRuns: async () => {
        calls++;
        return [{ id: 7 }];
      },
      retryRun: async (id, { targets }) => {
        calls++;
        return { runId: Number(id), targets };
      },
      approveAddition: async (id) => {
        calls++;
        return id === "7" ? { id: 3 } : null;
      },
      dismissAddition: async (id) => {
        calls++;
        return id === "7";
      },
    },
  };
  for (const dependency of [
    "../models/workspace",
    "../models/documents",
    "../models/eventLogs",
    "../utils/helpers",
    "../utils/synonyms",
    "../utils/schatAdmin/usageStats",
    "../utils/documentChecklists/repository",
    "../utils/schatAdmin",
    "../utils/schatAdmin/storageCleanup",
    "../utils/schatAdmin/originalReviewApi",
  ])
    deps[dependency] = {};
  deps["../utils/http"] = { reqBody: (request) => request.body };
  deps["../utils/schatAdmin/originalReviewApi"] = {
    createOriginalReviewApi: () => ({ preview: async () => {} }),
  };
  deps["../utils/schatAdmin/aiSettings"] = { createAiSettingsApi: () => ({}) };
  const routes = {};
  const app = {};
  for (const method of ["get", "post", "put", "delete"]) {
    app[method] = (route, ...handlers) => {
      routes[`${method} ${route}`] = handlers.flat();
    };
  }
  load("endpoints/schatAdmin.js", deps).schatAdminEndpoints(app);
  return {
    calls: () => calls,
    async invoke(route, token, id = "7", body = { ids: [7] }) {
      const res = {
        locals: {},
        statusCode: 200,
        status(code) {
          this.statusCode = code;
          return this;
        },
        sendStatus(code) {
          this.statusCode = code;
          return this;
        },
        json(body) {
          this.body = body;
          return this;
        },
        send(body) {
          this.body = body;
          return this;
        },
        end() {
          return this;
        },
      };
      for (const handler of routes[route]) {
        let next = false;
        await handler(
          { header: () => token, params: { id }, body },
          res,
          () => {
            next = true;
          }
        );
        if (!next) break;
      }
      return res;
    },
  };
}

const routes = [
  "get /schat-admin/synonyms/runs",
  "post /schat-admin/synonyms/suggestions/:id/approve",
  "post /schat-admin/synonyms/suggestions/:id/dismiss",
  "post /schat-admin/synonyms/suggestions/bulk-approve",
  "post /schat-admin/synonyms/runs/:id/retry",
  "get /schat-admin/synonyms/question-candidates/settings",
  "put /schat-admin/synonyms/question-candidates/settings",
];

test("질문 후보 한도는 관리자만 읽고 변경하며 오류 원문을 반환하지 않음", async () => {
  const app=setup();
  const path="/schat-admin/synonyms/question-candidates/settings";
  assert.equal((await app.invoke(`get ${path}`,"Bearer synthetic")).body.settings.limit,20);
  assert.equal((await app.invoke(`put ${path}`,"Bearer synthetic","7",{limit:0})).body.settings.limit,0);
  const bad=await app.invoke(`put ${path}`,"Bearer synthetic","7",{limit:-1});
  assert.equal(bad.statusCode,400);
  assert.equal(JSON.stringify(bad.body).includes("PRIVATE DRIVER"),false);
});

test("관리자는 실행 기록의 실패 범위 재시도를 요청할 수 있다", async () => {
  const app = setup();
  const result = await app.invoke(
    "post /schat-admin/synonyms/runs/:id/retry",
    "Bearer synthetic"
  );
  assert.equal(result.statusCode, 200);
  assert.equal(result.body.runId, 7);
  assert.equal(app.calls(), 1);
});
test("employees and anonymous callers cannot read or change candidates", async () => {
  for (const role of ["admin", "default"]) {
    const app = setup(role);
    for (const route of routes) {
      const result = await app.invoke(
        route,
        role === "default" ? "Bearer synthetic" : undefined
      );
      assert.equal(result.statusCode, 401);
    }
    assert.equal(app.calls(), 0);
  }
});
test("admins receive results and unknown candidate IDs return 404", async () => {
  const app = setup();
  assert.equal(
    (await app.invoke(routes[0], "Bearer synthetic")).body.runs[0].id,
    7
  );
  for (const route of routes.slice(1, 3)) {
    assert.equal(
      (await app.invoke(route, "Bearer synthetic")).body.success,
      true
    );
    assert.equal(
      (await app.invoke(route, "Bearer synthetic", "999")).statusCode,
      404
    );
  }
  assert.deepEqual(
    Array.from((await app.invoke(routes[3], "Bearer synthetic")).body.approved),
    [7]
  );
});
