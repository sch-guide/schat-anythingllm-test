const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

// Execute the real route and authentication/role/workspace middleware. Only
// session decoding, persistence, and the upload/replace side effects are fakes.
function setup({ role = "admin", workspaceAllowed = true, suspended = false, scopedOperations } = {}) {
  const root = path.resolve(__dirname, "../..");
  const effects = [];
  const user = { id: 1, role, suspended, must_change_password: false };
  const workspace = { id: 7, slug: "synthetic" };
  const http = {
    decodeJWT: token => token === "synthetic-session" ? { id: 1 } : null,
    userFromSession: async (_, response) => response.locals.user,
    multiUserMode: response => response.locals.multiUserMode,
    reqBody: request => request.body,
  };
  function load(relative, dependencies) {
    const filename = path.join(root, relative);
    const module = { exports: {} };
    vm.runInNewContext(fs.readFileSync(filename, "utf8"), {
      module, exports: module.exports, console, __dirname: path.dirname(filename),
      process: { env: { NODE_ENV: "production" } },
      require(name) {
        if (Object.hasOwn(dependencies, name)) return dependencies[name];
        if (name === "fs" || name === "path") return require(name);
        return {};
      },
    }, { filename });
    return module.exports;
  }
  const system = { SystemSettings: { isMultiUserMode: async () => true } };
  const validation = load("utils/middleware/validatedRequest.js", {
    "../../models/systemSettings": system,
    "../../models/user": { User: { get: async () => user } },
    "../EncryptionManager": { EncryptionManager: class {} },
    "../http": http,
    "../userLocale": { UserMetaCache: { setFromRequest() {} } },
  });
  const roles = load("utils/middleware/multiUserProtected.js", {
    "../../models/systemSettings": system, "../http": http,
  });
  const access = load("utils/middleware/validWorkspace.js", {
    "../../models/workspace": { Workspace: { getWithUser: async () => workspaceAllowed ? workspace : null } },
    "../http": http,
  });
  const routes = new Map();
  const { workspaceEndpoints } = load("endpoints/workspaces.js", {
    "../models/workspace": { Workspace: {
      getWithUser: async () => workspaceAllowed ? workspace : null,
      delete: async () => effects.push('workspace-delete'),
    } },
    "../models/workspaceChats": { WorkspaceChats: { delete: async () => effects.push('chat-delete') } },
    "../models/documents": { Document: { delete: async () => effects.push('document-delete') } },
    "../models/vectors": { DocumentVectors: { deleteForWorkspace: async () => effects.push('mapping-delete') } },
    "../models/eventLogs": { EventLogs: { logEvent: async () => effects.push('event') } },
    "../utils/helpers": { getVectorDbClass: () => ({ 'delete-namespace': async () => effects.push('vector-delete') }) },
    "../utils/documentUpdates/scopes": { operations: scopedOperations },
    "../utils/http": http,
    "../utils/middleware/validatedRequest": validation,
    "../utils/middleware/multiUserProtected": roles,
    "../utils/middleware/validWorkspace": access,
    "../utils/documentUpdates/readiness": require("../../utils/documentUpdates/readiness"),
    "../utils/synonyms/suggestions": { scheduleSynonymSuggestions: async () => {} },
    "./workspacesParsedFiles": { workspaceParsedFilesEndpoints() {} },
    "../utils/documentUpdates/upload": {
      handleDocumentUpdateUpload(request, _, next) { effects.push("upload"); request.files = []; next(); },
      async cleanupIncoming() { effects.push("cleanup"); },
    },
    "../utils/documentUpdates/service": {
      async executeDocumentUpdate(input) {
        assert.equal(input.workspace.id, 7);
        effects.push("replace");
        return { success: true, results: [], relatedItems: [], warnings: [] };
      },
    },
  });
  workspaceEndpoints(new Proxy({}, { get: (_, verb) => (route, ...handlers) => {
    routes.set(`${verb} ${route}`, handlers.flat());
  } }));
  async function invoke(authorization) {
    const request = {
      params: { slug: "synthetic" }, body: { manifest: "{}" },
      header: () => authorization,
    };
    const response = {
      locals: {}, statusCode: 200,
      status(code) { this.statusCode = code; return this; },
      sendStatus(code) { this.statusCode = code; return this; },
      json(body) { this.body = body; return this; },
      send(body) { this.body = body; return this; }, end() { return this; },
    };
    for (const handler of routes.get("post /workspace/:slug/document-update")) {
      let next = false;
      await handler(request, response, () => { next = true; });
      if (!next) break;
    }
    return response;
  }
  async function invokeReset(route) {
    const response = {
      locals: { user, multiUserMode: true }, statusCode: 200,
      status(code) { this.statusCode = code; return this; },
      sendStatus(code) { this.statusCode = code; return this; },
      json(body) { this.body = body; return this; }, end() { return this; },
    };
    await routes.get(`delete ${route}`).at(-1)({ params: { slug: workspace.slug } }, response);
    return response;
  }
  return { invoke, invokeReset, effects };
}

test('workspace delete and vector reset do not touch data while the workspace is in use', async () => {
  const { UpdateGuard } = require('../../utils/documentUpdates/guard');
  const { createScopedOperations } = require('../../utils/documentUpdates/scopes');
  const directory = await fs.promises.mkdtemp(path.join(require('node:os').tmpdir(), 'schat-reset-route-'));
  const operations = createScopedOperations(new UpdateGuard(directory));
  for (const route of ['/workspace/:slug', '/workspace/:slug/reset-vector-db']) {
    let entered, finish;
    const started = new Promise(resolve => { entered = resolve; });
    const gate = new Promise(resolve => { finish = resolve; });
    const active = operations.document(7, ['synthetic.pdf'], async () => { entered(); await gate; });
    await started;
    const app = setup({ scopedOperations: operations });
    try {
      const response = await app.invokeReset(route);
      assert.equal(response.statusCode, 423);
      assert.deepEqual(app.effects, []);
      assert.equal(response.body.error, '이 문서는 지금 업데이트 중입니다. 잠시 후 다시 시도해 주세요.');
    } finally { finish(); await active; }
    assert.equal((await app.invokeReset(route)).statusCode, 200);
    assert.ok(app.effects.includes('document-delete'));
    assert.ok(app.effects.includes('vector-delete'));
  }
});

test("unauthenticated update never receives or changes files", async () => {
  const { invoke, effects } = setup();
  assert.equal((await invoke()).statusCode, 401);
  assert.deepEqual(effects, []);
});
test("employee cannot reach document update upload", async () => {
  const { invoke, effects } = setup({ role: "default" });
  assert.equal((await invoke("Bearer synthetic-session")).statusCode, 401);
  assert.deepEqual(effects, []);
});
test("workspace denial occurs before temporary files are received", async () => {
  const { invoke, effects } = setup({ workspaceAllowed: false });
  assert.equal((await invoke("Bearer synthetic-session")).statusCode, 404);
  assert.deepEqual(effects, []);
});
test("suspended admin cannot reach document update upload", async () => {
  const { invoke, effects } = setup({ suspended: true });
  assert.equal((await invoke("Bearer synthetic-session")).statusCode, 401);
  assert.deepEqual(effects, []);
});
test("authorized admin reaches upload and replacement after readiness review", async () => {
  const { invoke, effects } = setup();
  const response = await invoke("Bearer synthetic-session");
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.success, true);
  assert.deepEqual(effects, ['upload','replace','cleanup']);
});
