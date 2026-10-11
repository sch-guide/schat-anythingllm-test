const test = require("node:test");
const assert = require("node:assert/strict");
const {
  personalStateHandler,
} = require("../../endpoints/checklistPersonalState");
function response() {
  return {
    code: 200,
    headers: {},
    set(k, v) {
      this.headers[k] = v;
      return this;
    },
    status(n) {
      this.code = n;
      return this;
    },
    json(data) {
      this.body = data;
      return this;
    },
  };
}
test("unauthenticated requests never read notes", async () => {
  const res = response();
  await personalStateHandler({
    getUser: async () => null,
    allowed: async () => true,
    store: {
      read() {
        throw Error("must not read");
      },
    },
  })({ method: "GET", params: { checklistId: "a" } }, res);
  assert.equal(res.code, 401);
  assert.equal(res.headers["Cache-Control"], "no-store");
});
test("owner comes from session, not supplied userId", async () => {
  const res = response();
  let owner;
  await personalStateHandler({
    getUser: async () => ({ id: 4 }),
    allowed: async () => true,
    store: {
      read: async (id) => {
        owner = id;
        return null;
      },
    },
  })({ method: "GET", params: { checklistId: "a" }, body: { userId: 9 } }, res);
  assert.equal(owner, 4);
  assert.equal(res.code, 200);
});
test("unauthorized checklist and DB errors cannot leak content", async () => {
  const deps = {
    getUser: async () => ({ id: 4 }),
    allowed: async () => false,
    store: {
      read: async () => {
        throw Error("PRIVATE");
      },
    },
  };
  let res = response();
  const req = { method: "GET", params: { checklistId: "a" } };
  await personalStateHandler(deps)(req, res);
  assert.equal(res.code, 404);
  res = response();
  await personalStateHandler({ ...deps, allowed: async () => true })(req, res);
  assert.equal(res.code, 503);
  assert.ok(!JSON.stringify(res.body).includes("PRIVATE"));
});
test("stale save returns conflict without another copy of notes", async () => {
  const res = response();
  await personalStateHandler({
    getUser: async () => ({ id: 4 }),
    allowed: async () => true,
    store: {
      save: async () => {
        throw Object.assign(Error("PRIVATE"), { code: "CONFLICT" });
      },
    },
  })({ method: "PUT", params: { checklistId: "a" }, body: {} }, res);
  assert.equal(res.code, 409);
  assert.equal(res.body.code, "CONFLICT");
});
