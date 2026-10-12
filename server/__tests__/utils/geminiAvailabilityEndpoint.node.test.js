const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { createMonitor } = require("../../utils/geminiAvailability");

function setup(role = "admin") {
  const root = path.resolve(__dirname, "../..");
  function load(file, deps) {
    const module = { exports: {} };
    vm.runInNewContext(fs.readFileSync(path.join(root, file), "utf8"), {
      module,
      exports: module.exports,
      console,
      process: { env: { NODE_ENV: "production" } },
      require: (name) => {
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
  const monitor = createMonitor(() => 1000);
  const routes = {};
  let saved = null;
  let recharge = { revision: 0, records: [] };
  load("endpoints/geminiAvailability.js", {
    "../utils/middleware/validatedRequest": validated,
    "../utils/middleware/multiUserProtected": roles,
    "../utils/geminiAvailability": { monitor },
    "../utils/aiRecharges": {
      loadFees: async () => ({ percent: 80, level: "warning", ...recharge }),
      rechargeStore: () => ({
        mutate: async (body, action) => {
          if (body.revision !== recharge.revision) {
            const error = Error("새로고침해 주세요.");
            error.status = 409;
            throw error;
          }
          recharge = {
            revision: recharge.revision + 1,
            records:
              action === "delete"
                ? []
                : [{ id: "test", amountKrw: body.amountKrw, date: body.date }],
          };
          return recharge;
        },
      }),
    },
    "../utils/geminiBudget": {
      loadBudget: async () => ({ percent: 80, level: "warning" }),
      validateConfig: require("../../utils/geminiBudget").validateConfig,
      saveBudget: async (config) => {
        saved = config;
        return config;
      },
    },
  }).geminiAvailabilityEndpoints({
    get(route, ...items) {
      routes["GET " + route] = items.flat();
    },
    put(route, ...items) {
      routes["PUT " + route] = items.flat();
    },
    post(route, ...items) {
      routes["POST " + route] = items.flat();
    },
    delete(route, ...items) {
      routes["DELETE " + route] = items.flat();
    },
  });
  return {
    monitor,
    saved: () => saved,
    async invoke(token, method = "GET", body, route) {
      const res = {
        locals: {},
        statusCode: 200,
        headers: {},
        set(key, value) {
          this.headers[key] = value;
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
      for (const handler of routes[
        method +
          " /schat-admin/" +
          (route ||
            (method === "GET" ? "gemini-availability" : "gemini-budget"))
      ]) {
        let next = false;
        await handler(
          { header: () => token, body, params: { id: "test" } },
          res,
          () => (next = true)
        );
        if (!next) break;
      }
      return res;
    },
  };
}
test("unauthenticated and employee access are rejected", async () => {
  assert.equal((await setup().invoke()).statusCode, 401);
  assert.equal(
    (await setup("default").invoke("Bearer synthetic")).statusCode,
    401
  );
});
test("recharge CRUD rejects employees and stale revisions while preserving real AI quota state", async () => {
  const employee = setup("default");
  assert.equal(
    (
      await employee.invoke(
        "Bearer synthetic",
        "POST",
        { revision: 0 },
        "ai-recharges"
      )
    ).statusCode,
    401
  );
  const { invoke, monitor } = setup();
  const body = { revision: 0, amountKrw: 8000, date: "2026-10-11" };
  const created = await invoke(
    "Bearer synthetic",
    "POST",
    body,
    "ai-recharges"
  );
  assert.equal(created.body.revision, 1);
  assert.equal(
    (await invoke("Bearer synthetic", "PUT", body, "ai-recharges/:id"))
      .statusCode,
    409
  );
  assert.equal(
    (
      await invoke(
        "Bearer synthetic",
        "PUT",
        { ...body, revision: 1 },
        "ai-recharges/:id"
      )
    ).body.revision,
    2
  );
  await assert.rejects(
    monitor.wrap(async () => {
      throw { status: 429, message: "daily quota exceeded" };
    }, "test")()
  );
  assert.equal(
    (
      await invoke(
        "Bearer synthetic",
        "DELETE",
        { revision: 2 },
        "ai-recharges/:id"
      )
    ).body.records.length,
    0
  );
  assert.equal(
    (await invoke("Bearer synthetic")).body.state.status,
    "exhausted"
  );
});
test("admin sees first occurrence only, and successful matching call clears it", async () => {
  const { monitor, invoke } = setup();
  await assert.rejects(
    monitor.wrap(async () => {
      throw { status: 429, message: "daily quota exceeded; private data" };
    }, "private-model")()
  );
  const res = await invoke("Bearer synthetic");
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers["Cache-Control"], "no-store");
  assert.equal(res.body.alerts[0].firstOccurredAt, "1970-01-01T00:00:01.000Z");
  assert.equal(res.body.budget.percent, 80);
  assert.equal(res.body.state.status, "exhausted");
  assert.ok(!JSON.stringify(res.body).includes("private"));
  await monitor.wrap(async () => ({ choices: [{}] }), "private-model")();
  assert.equal((await invoke("Bearer synthetic")).body.alerts.length, 0);
});
test("only admins can save a valid budget; invalid input is not persisted", async () => {
  const config = {
    monthlyBudgetKrw: 100000,
    rates: [{ model: "gemini-test", inputKrw: 1000, outputKrw: 2000 }],
  };
  const employee = setup("default");
  assert.equal(
    (await employee.invoke("Bearer synthetic", "PUT", config)).statusCode,
    401
  );
  assert.equal(employee.saved(), null);
  const admin = setup();
  assert.equal(
    (await admin.invoke("Bearer synthetic", "PUT", { monthlyBudgetKrw: -1 }))
      .statusCode,
    400
  );
  assert.equal(admin.saved(), null);
  assert.equal(
    (await admin.invoke("Bearer synthetic", "PUT", config)).statusCode,
    200
  );
  assert.equal(admin.saved().monthlyBudgetKrw, 100000);
});
