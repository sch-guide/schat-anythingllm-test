const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function setup(role = "default", multi = true) {
  const root = path.resolve(__dirname, "../..");
  const user = { id: 7, role, suspended: false, must_change_password: false };
  const chats = [
    {
      id: 11,
      workspaceId: 2,
      thread_id: null,
      user_id: 7,
      prompt: "원래 질문",
      response: '{"text":"원래 답변"}',
      include: true,
    },
    {
      id: 12,
      workspaceId: 2,
      thread_id: 3,
      user_id: 7,
      prompt: "대화 질문",
      response: '{"text":"대화 답변"}',
      include: true,
    },
    {
      id: 13,
      workspaceId: 2,
      thread_id: null,
      user_id: 8,
      prompt: "타인 질문",
      response: '{"text":"타인 답변"}',
      include: true,
    },
    {
      id: 14,
      workspaceId: 9,
      thread_id: null,
      user_id: 7,
      prompt: "다른 공간 질문",
      response: '{"text":"다른 공간 답변"}',
      include: true,
    },
  ];
  chats.forEach((chat) => {
    chat.api_session_id = null;
  });
  const initial = JSON.stringify(chats);
  const writes = [];
  const errors = [];
  const threads = [{ id: 3, workspace_id: 2, user_id: 7, slug: "thread" }];
  const http = {
    reqBody: (req) =>
      typeof req.body === "string" ? JSON.parse(req.body) : req.body,
    decodeJWT: (token) => (token === "valid" ? { id: 7 } : {}),
    userFromSession: async (_, res) => res.locals.user ?? null,
    multiUserMode: (res) => res.locals.multiUserMode,
    safeJsonParse: (text, fallback) => {
      try {
        return JSON.parse(text);
      } catch {
        return fallback;
      }
    },
  };
  const system = { SystemSettings: { isMultiUserMode: async () => multi } };
  const workspace = { id: 2, slug: "space" };
  const matches = (chat, filter) =>
    Object.entries(filter).every(([key, value]) => {
      if (value && typeof value === "object") {
        if (value.in) return value.in.includes(chat[key]);
        if ("gte" in value) return chat[key] >= value.gte;
        if ("lte" in value) return chat[key] <= value.lte;
      }
      return chat[key] === value;
    });
  const deps = {
    "../http": http,
    "../utils/http": http,
    "../../models/systemSettings": system,
    "../models/systemSettings": system,
    dotenv: { config() {} },
    "../../models/user": { User: { get: async () => user } },
    "../EncryptionManager": { EncryptionManager: class {} },
    "../userLocale": { UserMetaCache: { setFromRequest() {} } },
    "../../models/workspace": {
      Workspace: {
        get: async () => workspace,
        getWithUser: async () => workspace,
      },
    },
    "../../models/workspaceThread": {
      WorkspaceThread: { get: async () => threads[0] },
    },
    "../models/workspaceChats": {
      WorkspaceChats: {
        get: async (filter) => chats.find((chat) => matches(chat, filter)),
        _update: async (id, patch) => {
          writes.push("update");
          Object.assign(
            chats.find((chat) => chat.id === id),
            patch
          );
        },
        delete: async (filter) => {
          writes.push("delete");
          for (let i = chats.length - 1; i >= 0; i--)
            if (matches(chats[i], filter)) chats.splice(i, 1);
        },
        where: async (filter) => chats.filter((chat) => matches(chat, filter)),
        whereWithData: async () => chats,
        count: async () => chats.length,
        bulkCreate: async (rows) => {
          writes.push("copy");
          chats.push(...rows);
        },
      },
    },
    "../models/workspaceThread": {
      WorkspaceThread: {
        get: async () => threads[0],
        new: async () => {
          writes.push("fork");
          const thread = { id: 4, slug: "fork" };
          threads.push(thread);
          return { thread };
        },
        update: async () => {
          writes.push("thread-update");
        },
      },
    },
    "../models/eventLogs": { EventLogs: { logEvent: async () => {} } },
    "../utils/helpers": { stripThinkingFromText: (text) => text },
    truncate: (text) => text,
    "./workspacesParsedFiles": { workspaceParsedFilesEndpoints() {} },
  };
  function load(file) {
    const module = { exports: {} };
    vm.runInNewContext(
      fs.readFileSync(path.join(root, file), "utf8"),
      {
        module,
        exports: module.exports,
        console: { ...console, error: (...args) => errors.push(args) },
        process: { env: { NODE_ENV: "development" } },
        require: (name) => {
          if (name in deps) return deps[name];
          if (name === "../utils/middleware/answerActionPermission")
            return load("utils/middleware/answerActionPermission.js");
          return {};
        },
      },
      { filename: file }
    );
    return module.exports;
  }
  deps["../utils/middleware/validatedRequest"] = load(
    "utils/middleware/validatedRequest.js"
  );
  deps["../utils/middleware/multiUserProtected"] = load(
    "utils/middleware/multiUserProtected.js"
  );
  deps["../utils/middleware/validWorkspace"] = load(
    "utils/middleware/validWorkspace.js"
  );
  deps["../utils/middleware/chatHistoryViewable"] = load(
    "utils/middleware/chatHistoryViewable.js"
  );
  const routes = new Map();
  const app = Object.fromEntries(
    ["get", "post", "put", "delete"].map((method) => [
      method,
      (route, ...handlers) => routes.set(`${method} ${route}`, handlers.flat()),
    ])
  );
  load("endpoints/workspaces.js").workspaceEndpoints(app);
  load("endpoints/workspaceThreads.js").workspaceThreadEndpoints(app);
  load("endpoints/system.js").systemEndpoints(app);
  return {
    chats,
    writes,
    initial,
    threads,
    async invoke(method, route, body, token = "valid") {
      const request = {
        body,
        params: { slug: "space", threadSlug: "thread", id: "11" },
        header: () => `Bearer ${token}`,
      };
      const response = {
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
        json(data) {
          this.data = data;
          return this;
        },
        end() {
          return this;
        },
      };
      for (const handler of routes.get(`${method} ${route}`) ?? []) {
        let next = false;
        assert.equal(typeof handler, "function");
        await handler(request, response, () => {
          next = true;
        });
        if (!next) break;
      }
      return response;
    },
  };
}

const destructive = [
  ["delete", "/workspace/:slug/delete-chats", { chatIds: [11, 12] }],
  ["delete", "/workspace/:slug/delete-edited-chats", { startingId: 11 }],
  [
    "delete",
    "/workspace/:slug/thread/:threadSlug/delete-edited-chats",
    { startingId: 12 },
  ],
  ["post", "/workspace/:slug/thread/fork", { chatId: 11 }],
  [
    "post",
    "/workspace/:slug/thread/fork",
    { chatId: 12, threadSlug: "thread" },
  ],
  ["put", "/workspace/workspace-chats/:id", {}],
];
for (const role of ["default", "manager"]) {
  for (const [method, route, body] of destructive)
    test(`${role}: ${route} 거절 및 기록 보존`, async () => {
      const app = setup(role);
      const result = await app.invoke(method, route, {
        ...body,
        role: "admin",
        user: { role: "admin" },
      });
      assert.equal(result.statusCode, 403);
      assert.equal(JSON.stringify(app.chats), app.initial);
      assert.deepEqual(app.writes, []);
      assert.equal(app.threads.length, 1);
    });
  for (const [route, chatId] of [
    ["/workspace/:slug/update-chat", 11],
    ["/workspace/:slug/thread/:threadSlug/update-chat", 12],
  ]) {
    for (const editRole of ["assistant", undefined, "admin", "USER", null])
      test(`${role}: ${route} ${editRole} 답변 수정 거절`, async () => {
        const app = setup(role);
        assert.equal(
          (
            await app.invoke("post", route, {
              chatId,
              newText: "변조",
              role: editRole,
            })
          ).statusCode,
          403
        );
        assert.equal(JSON.stringify(app.chats), app.initial);
        assert.deepEqual(app.writes, []);
      });
    test(`${role}: ${route} 본인 질문만 저장`, async () => {
      const app = setup(role);
      assert.equal(
        (
          await app.invoke("post", route, {
            chatId,
            newText: "수정 질문",
            role: "user",
          })
        ).statusCode,
        200
      );
      assert.equal(app.chats.find((c) => c.id === chatId).prompt, "수정 질문");
      assert.equal(
        app.chats.find((c) => c.id === chatId).response,
        chatId === 11 ? '{"text":"원래 답변"}' : '{"text":"대화 답변"}'
      );
    });
  }
}
for (const [role, multi] of [
  ["admin", true],
  [null, false],
]) {
  for (const [method, route, body] of destructive)
    test(`${multi ? "관리자" : "단독 소유자"}: ${route} 기존 기능 유지`, async () => {
      const app = setup(role, multi);
      if (!multi)
        app.chats.forEach((chat) => {
          chat.user_id = null;
        });
      assert.equal((await app.invoke(method, route, body)).statusCode, 200);
      assert.ok(app.writes.length > 0);
    });
  for (const [route, chatId] of [
    ["/workspace/:slug/update-chat", 11],
    ["/workspace/:slug/thread/:threadSlug/update-chat", 12],
  ])
    test(`${role}: ${route} 답변 수정 유지`, async () => {
      const app = setup(role, multi);
      if (!multi)
        app.chats.forEach((chat) => {
          chat.user_id = undefined;
        });
      assert.equal(
        (
          await app.invoke("post", route, {
            chatId,
            newText: "관리 수정",
            role: "assistant",
          })
        ).statusCode,
        200
      );
      assert.equal(
        JSON.parse(app.chats.find((c) => c.id === chatId).response).text,
        "관리 수정"
      );
    });
}
test("위조 인증은 실제 인증 검사에서 차단", async () => {
  const app = setup("default");
  assert.equal(
    (
      await app.invoke(
        "put",
        "/workspace/workspace-chats/:id",
        { role: "admin" },
        "forged"
      )
    ).statusCode,
    401
  );
  assert.deepEqual(app.writes, []);
});
test("관리자 대화 삭제·숨김·분기는 기존 본인과 작업공간 필터를 유지", async () => {
  for (const [method, route, body] of destructive) {
    const app = setup("admin");
    const foreign = JSON.stringify(
      app.chats.filter((chat) => [13, 14].includes(chat.id))
    );
    assert.equal((await app.invoke(method, route, body)).statusCode, 200);
    assert.equal(
      JSON.stringify(app.chats.filter((chat) => [13, 14].includes(chat.id))),
      foreign
    );
    if (route.endsWith("/fork")) {
      assert.equal(app.chats.filter((chat) => chat.thread_id === 4).length, 1);
      assert.ok(
        app.chats
          .filter((chat) => chat.thread_id === 4)
          .every((chat) => chat.user_id === 7 && chat.workspaceId === 2)
      );
    }
  }
});
test("직원이 다른 사람 질문을 지정해도 저장되지 않음", async () => {
  const app = setup();
  assert.equal(
    (
      await app.invoke("post", "/workspace/:slug/update-chat", {
        chatId: 13,
        newText: "변조",
        role: "user",
      })
    ).statusCode,
    500
  );
  assert.equal(JSON.stringify(app.chats), app.initial);
  assert.deepEqual(app.writes, []);
});
test("관리 대화 API는 일반 직원 접근을 막고 관리자·관리 담당자의 기존 조회·삭제를 유지", async () => {
  for (const role of ["default", "admin", "manager"]) {
    const app = setup(role);
    const list = await app.invoke("post", "/system/workspace-chats", {
      offset: 0,
      limit: 20,
    });
    const deletion = await app.invoke(
      "delete",
      "/system/workspace-chats/:id",
      {}
    );
    if (role === "default") {
      assert.equal(list.statusCode, 401);
      assert.equal(deletion.statusCode, 401);
      assert.equal(JSON.stringify(app.chats), app.initial);
      assert.deepEqual(app.writes, []);
    } else {
      assert.equal(list.statusCode, 200);
      assert.equal(list.data.totalChats, 4);
      assert.equal(deletion.statusCode, 200);
      assert.equal(
        app.chats.some((chat) => chat.id === 11),
        false
      );
      assert.equal(app.chats.length, 3);
    }
  }
});
