const test = require("node:test");
const assert = require("node:assert/strict");
const { createAiSettingsApi } = require("../../../utils/schatAdmin/aiSettings");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");

function response(role = "admin") {
  return {
    locals: { multiUserMode: true, user: { id: 1, role } },
    status(code) {
      this.code = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
}
function setup(fetchImpl, extra = {}) {
  const env = {
    LLM_PROVIDER: "gemini",
    GEMINI_LLM_MODEL_PREF: "gemini-old",
    GEMINI_API_KEY: "old-secret",
    EMBEDDING_ENGINE: "gemini",
    EMBEDDING_MODEL_PREF: "gemini-embedding-2",
    GEMINI_EMBEDDING_API_KEY: "embedding-secret",
  };
  const writes = [];
  const api = createAiSettingsApi({
    env,
    fetchImpl:
      fetchImpl ||
      (async (url) => ({
        ok: true,
        status: 200,
        json: async () => ({
          models: [
            {
              name: "models/gemini-new",
              supportedGenerationMethods: ["generateContent"],
            },
            {
              name: "models/gemini-embedding-2",
              supportedGenerationMethods: ["embedContent"],
            },
          ],
        }),
      })),
    body: (req) => req.body,
    persist: async (values) => {
      writes.push(values);
      if (values.GeminiLLMModelPref)
        env.GEMINI_LLM_MODEL_PREF = values.GeminiLLMModelPref;
      if (values.GeminiLLMApiKey) env.GEMINI_API_KEY = values.GeminiLLMApiKey;
      if (values.GeminiEmbeddingApiKey)
        env.GEMINI_EMBEDDING_API_KEY = values.GeminiEmbeddingApiKey;
      return { error: false };
    },
    ...extra,
  });
  return { api, env, writes };
}
async function list(api, body = {}) {
  const res = response();
  await api.models({ body }, res);
  return res;
}
async function save(api, revision, body = {}) {
  const res = response();
  await api.save(
    { body: { target: "llm", model: "gemini-new", revision, ...body } },
    res
  );
  return res;
}

test("생성을 지원하는 Gemini 모델만 반환하고 후보 열쇠를 저장하지 않는다", async () => {
  const calls = [];
  const { api, writes, env } = setup(async (url, opts) => {
    calls.push([url, opts]);
    return {
      ok: true,
      status: 200,
      json: async () => ({
        models: [
          {
            name: "models/gemini-new",
            supportedGenerationMethods: ["generateContent"],
          },
          {
            name: "models/gemini-embedding-2",
            supportedGenerationMethods: ["embedContent"],
          },
          {
            name: "models/other-model",
            supportedGenerationMethods: ["generateContent"],
          },
        ],
      }),
    };
  });
  const res = await list(api, { apiKey: "candidate-secret" });
  assert.deepEqual(res.body.models, ["gemini-new"]);
  assert.equal(res.body.ok, true);
  assert.equal(typeof res.body.revision, "string");
  assert.equal(calls[0][1].headers["x-goog-api-key"], "candidate-secret");
  assert.equal(calls[0][1].body, undefined);
  assert.doesNotMatch(calls[0][0], /secret/);
  assert.equal(writes.length, 0);
  assert.equal(env.GEMINI_API_KEY, "old-secret");
  assert.doesNotMatch(JSON.stringify(res.body), /secret/);
});

test("후보 모델과 열쇠 연결 성공 후 함께 저장하며 빈 열쇠는 기존 값 사용", async () => {
  const calls = [];
  const { api, env, writes } = setup(async (url, opts) => {
    calls.push([url, opts.headers["x-goog-api-key"]]);
    return {
      ok: true,
      status: 200,
      json: async () => ({
        models: [
          {
            name: "models/gemini-new",
            supportedGenerationMethods: ["generateContent"],
          },
        ],
      }),
    };
  });
  let listed = await list(api);
  let res = await save(api, listed.body.revision, { apiKey: "new-secret" });
  assert.equal(res.body.ok, true);
  assert.equal(env.GEMINI_API_KEY, "new-secret");
  assert.equal(env.GEMINI_LLM_MODEL_PREF, "gemini-new");
  assert.deepEqual(writes, [
    { GeminiLLMModelPref: "gemini-new", GeminiLLMApiKey: "new-secret" },
  ]);
  assert.deepEqual(
    calls.slice(-2).map(([, key]) => key),
    ["new-secret", "new-secret"]
  );
  assert.match(calls.at(-1)[0], /models\/gemini-new$/);
  listed = await list(api);
  res = await save(api, listed.body.revision, { apiKey: "" });
  assert.equal(res.body.ok, true);
  assert.deepEqual(writes.at(-1), { GeminiLLMModelPref: "gemini-new" });
  assert.doesNotMatch(JSON.stringify(res.body), /secret|newValues/);
  assert.equal(env.GEMINI_EMBEDDING_API_KEY, "embedding-secret");
});

test("목록 불가·목록 밖 모델·연결 실패·시간 초과는 이전 값 보존", async () => {
  for (const mode of [
    "list-error",
    "not-listed",
    "connection-error",
    "timeout",
    "connection-timeout",
    "malformed",
  ]) {
    const { api, env, writes } = setup(
      async (url, { signal }) => {
        const isList = new URL(url).pathname.endsWith("/models");
        if (mode === "timeout" || (mode === "connection-timeout" && !isList))
          return await new Promise((_, reject) =>
            signal.addEventListener("abort", () =>
              reject(
                Object.assign(new Error("private new-secret"), {
                  name: "AbortError",
                })
              )
            )
          );
        if (mode === "list-error" || (mode === "connection-error" && !isList))
          return { ok: false, status: 403 };
        return {
          ok: true,
          status: 200,
          json: async () =>
            mode === "malformed"
              ? {}
              : {
                  models: [
                    {
                      name:
                        "models/" +
                        (mode === "not-listed" ? "gemini-other" : "gemini-new"),
                      supportedGenerationMethods: ["generateContent"],
                    },
                  ],
                },
        };
      },
      { timeoutMs: 5 }
    );
    const revision = api.revision();
    const before = { ...env };
    const res = await save(api, revision, { apiKey: "new-secret" });
    assert.equal(res.body.ok, false, mode);
    assert.deepEqual(env, before, mode);
    assert.equal(writes.length, 0, mode);
    assert.doesNotMatch(JSON.stringify(res.body), /private|secret/);
  }
});

test("모든 페이지를 확인하며 뒤 페이지 오류와 오래된 목록 요청은 저장 없이 거부한다", async () => {
  let calls = 0;
  let fail = false;
  const { api, writes } = setup(async (url) => {
    calls++;
    return new URL(url).searchParams.has("pageToken")
      ? fail
        ? { ok: false, status: 500 }
        : {
            ok: true,
            json: async () => ({
              models: [
                {
                  name: "models/gemini-new",
                  supportedGenerationMethods: ["generateContent"],
                },
              ],
            }),
          }
      : {
          ok: true,
          json: async () => ({
            models: [
              {
                name: "models/gemini-old",
                supportedGenerationMethods: ["generateContent"],
              },
            ],
            nextPageToken: "next",
          }),
        };
  });
  let res = await list(api);
  assert.deepEqual(res.body.models, ["gemini-new", "gemini-old"]);
  assert.equal(calls, 2);
  fail = true;
  res = await list(api);
  assert.equal(res.body.ok, false);
  res = await list(api, { revision: "stale" });
  assert.equal(res.code, 409);
  assert.equal(calls, 4);
  assert.equal(writes.length, 0);
});

test("AI 설정 경로에 기존 로그인·관리자 검사와 실제 안전 처리기가 등록된다", async () => {
  const routes = [];
  const env = { LLM_PROVIDER: "gemini", GEMINI_API_KEY: "old-secret" };
  const validated = () => {};
  const roleModule = { exports: {} };
  vm.runInNewContext(
    fs.readFileSync(
      path.resolve(
        __dirname,
        "../../../utils/middleware/multiUserProtected.js"
      ),
      "utf8"
    ),
    { module: roleModule, exports: roleModule.exports, require: () => ({}) }
  );
  const module = { exports: {} };
  vm.runInNewContext(
    fs.readFileSync(
      path.resolve(__dirname, "../../../endpoints/schatAdmin.js"),
      "utf8"
    ),
    {
      module,
      exports: module.exports,
      require: (name) => {
        if (name === "node:crypto") return require(name);
        if (name === "../utils/http") return { reqBody: (req) => req.body };
        if (name === "../utils/middleware/validatedRequest")
          return { validatedRequest: validated };
        if (name === "../utils/middleware/multiUserProtected")
          return roleModule.exports;
        if (name === "../utils/schatAdmin/aiSettings")
          return {
            createAiSettingsApi: (options) =>
              createAiSettingsApi({
                ...options,
                env,
                fetchImpl: () => assert.fail("must not call"),
              }),
          };
        if (name === "../utils/schatAdmin/originalReviewApi")
          return { createOriginalReviewApi: () => ({}) };
        return {};
      },
    }
  );
  const app = Object.fromEntries(
    ["get", "post", "put", "delete"].map((method) => [
      method,
      (...args) => routes.push([method, ...args]),
    ])
  );
  module.exports.schatAdminEndpoints(app);
  for (const [method, url] of [
    ["get", "/schat-admin/ai-settings"],
    ["post", "/schat-admin/ai-models"],
    ["put", "/schat-admin/ai-settings"],
  ]) {
    const route = routes.find((row) => row[0] === method && row[1] === url);
    assert.ok(route);
    assert.equal(route[2][0], validated);
    const res = response("default");
    res.sendStatus = function (code) {
      this.code = code;
      return this;
    };
    res.end = function () {
      return this;
    };
    let reached = false;
    await route[2][1]({}, res, () => (reached = true));
    assert.equal(res.code, 401);
    assert.equal(reached, false);
    const admin = response();
    await route[2][1]({}, admin, () => (reached = true));
    assert.equal(reached, true);
    if (method === "get") {
      await route[3]({}, admin);
      assert.equal(admin.body.ok, true);
      assert.doesNotMatch(JSON.stringify(admin.body), /old-secret/);
    }
  }
});

test("직원 요청·잘못된 입력은 호출과 저장 전에 거부한다", async () => {
  let calls = 0;
  const { api, writes } = setup(async () => {
    calls++;
    throw Error("must not call");
  });
  for (const role of ["default", "manager", null])
    for (const method of ["models", "save"]) {
      const res = response(role);
      await api[method](
        {
          body: {
            target: "llm",
            model: "gemini-new",
            revision: api.revision(),
          },
        },
        res
      );
      assert.equal(res.code, 403);
    }
  for (const body of [
    { model: "unknown" },
    { apiKey: "***" },
    { apiKey: "key\nINJECT=value" },
    { apiKey: 7 },
    { revision: "stale" },
    { target: "arbitrary" },
  ]) {
    const res = await save(api, api.revision(), body);
    assert.equal(res.body.ok, false);
  }
  assert.equal(calls, 0);
  assert.equal(writes.length, 0);
});

test("동시 저장과 오래된 화면의 저장은 409로 거부한다", async () => {
  let release;
  let pending = false;
  const { api, env, writes } = setup(async () => {
    if (pending) await new Promise((resolve) => (release = resolve));
    return {
      ok: true,
      status: 200,
      json: async () => ({
        models: [
          {
            name: "models/gemini-new",
            supportedGenerationMethods: ["generateContent"],
          },
        ],
      }),
    };
  });
  const revision = api.revision();
  pending = true;
  const first = save(api, revision, { apiKey: "new-secret" });
  await new Promise((resolve) => setImmediate(resolve));
  const second = await save(api, revision);
  assert.equal(second.code, 409);
  pending = false;
  release();
  assert.equal((await first).body.ok, true);
  assert.equal(writes.length, 1);
  const stale = await save(api, revision);
  assert.equal(stale.code, 409);
  assert.equal(env.GEMINI_API_KEY, "new-secret");
});

test("검증 도중 설정이 바뀌면 저장하지 않는다", async () => {
  let env;
  const state = setup(async () => {
    env.GEMINI_API_KEY = "outside-secret";
    return {
      ok: true,
      status: 200,
      json: async () => ({
        models: [
          {
            name: "models/gemini-new",
            supportedGenerationMethods: ["generateContent"],
          },
        ],
      }),
    };
  });
  env = state.env;
  const res = await save(state.api, state.api.revision());
  assert.equal(res.code, 409);
  assert.equal(state.writes.length, 0);
  assert.equal(env.GEMINI_API_KEY, "outside-secret");
});

test("검색의 답변 열쇠 대체 사용 상태에서 답변 열쇠 변경은 검색 열쇠를 보존한다", async () => {
  const { api, env, writes } = setup();
  delete env.GEMINI_EMBEDDING_API_KEY;
  const res = await save(api, api.revision(), { apiKey: "new-secret" });
  assert.equal(res.body.ok, true);
  assert.equal(env.GEMINI_API_KEY, "new-secret");
  assert.equal(env.GEMINI_EMBEDDING_API_KEY, "old-secret");
  assert.deepEqual(writes, [
    {
      GeminiLLMModelPref: "gemini-new",
      GeminiLLMApiKey: "new-secret",
      GeminiEmbeddingApiKey: "old-secret",
    },
  ]);
});

test("기존 저장 함수의 부분 변경 후 실패도 메모리 설정을 복구하며 비밀 오류는 숨긴다", async () => {
  for (const throws of [true, false]) {
    let env;
    const state = setup(undefined, {
      persist: async () => {
        env.GEMINI_API_KEY = "partial-secret";
        env.GEMINI_LLM_MODEL_PREF = "gemini-new";
        if (throws) throw Error("private partial-secret");
        return { error: "private partial-secret" };
      },
    });
    env = state.env;
    const before = { ...env };
    const res = await save(state.api, state.api.revision(), {
      apiKey: "new-secret",
    });
    assert.equal(res.body.ok, false);
    assert.deepEqual(env, before);
    assert.doesNotMatch(JSON.stringify(res.body), /private|secret/);
  }
});

test("검색 열쇠도 저장 전 기존 검색 모델로 검증하며 모델 변경은 거부한다", async () => {
  const calls = [];
  const { api, env } = setup(async (url, opts) => {
    calls.push([url, opts.headers["x-goog-api-key"]]);
    return { ok: true, status: 200 };
  });
  let res = await save(api, api.revision(), {
    target: "embedding",
    model: "gemini-embedding-2",
    apiKey: "new-embedding-secret",
  });
  assert.equal(res.body.ok, true);
  assert.equal(env.GEMINI_EMBEDDING_API_KEY, "new-embedding-secret");
  assert.equal(env.GEMINI_API_KEY, "old-secret");
  assert.deepEqual(calls, [
    [
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-2",
      "new-embedding-secret",
    ],
  ]);
  res = await save(api, api.revision(), {
    target: "embedding",
    model: "gemini-new",
    apiKey: "next-secret",
  });
  assert.equal(res.body.ok, false);
  assert.equal(calls.length, 1);
});

test("환경 파일 저장 실패는 기존 파일을 보존하고 임시 열쇠 파일을 남기지 않는다", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "schat-ai-env-"));
  const envPath = path.join(root, ".env");
  fs.writeFileSync(envPath, "GEMINI_API_KEY='old-secret'\n");
  const env = { NODE_ENV: "production", GEMINI_API_KEY: "new-secret" };
  const code = fs.readFileSync(
    path.resolve(__dirname, "../../../utils/helpers/updateENV.js"),
    "utf8"
  );
  const module = { exports: {} };
  const mockFs = {
    ...fs,
    writeFileSync(file, ...args) {
      if (file === envPath)
        throw Error("direct write would truncate existing file");
      return fs.writeFileSync(file, ...args);
    },
    renameSync() {
      throw Error("private new-secret disk-error");
    },
  };
  vm.runInNewContext(code, {
    module,
    exports: module.exports,
    __dirname: path.join(root, "utils", "helpers"),
    process: { env },
    console,
    require: (name) =>
      name === "fs"
        ? mockFs
        : name === "../../models/telemetry"
          ? { Telemetry: {} }
          : name === "../vectorStore/resetAllVectorStores"
            ? {}
            : name === "../../models/eventLogs"
              ? {
                  EventLogs: {
                    logEvent: async () =>
                      assert.fail(
                        "secret changes must not create log metadata"
                      ),
                  },
                }
              : require(name),
  });
  try {
    await assert.rejects(
      () =>
        module.exports.updateENV({ GeminiLLMApiKey: "new-secret" }, false, 1, {
          atomicDump: true,
        }),
      /disk-error/
    );
    assert.equal(
      fs.readFileSync(envPath, "utf8"),
      "GEMINI_API_KEY='old-secret'\n"
    );
    assert.deepEqual(fs.readdirSync(root), [".env"]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("Docker에서 연결된 환경 파일은 교체 제한에도 저장하고 쓰기 실패에는 원문을 복구한다", async () => {
  for (const mode of ["success", "write-failure", "restore-failure"]) {
    const root = fs.mkdtempSync(
      path.join(os.tmpdir(), "schat-ai-mounted-env-")
    );
    const envPath = path.join(root, ".env");
    const original = "GEMINI_API_KEY='old-secret'\n";
    fs.writeFileSync(envPath, original);
    let failed = false;
    const mockFs = {
      ...fs,
      renameSync() {
        throw Object.assign(Error("mounted file"), { code: "EBUSY" });
      },
      writeFileSync(file, contents, options) {
        if (
          mode !== "success" &&
          file === envPath &&
          (!failed || mode === "restore-failure")
        ) {
          failed = true;
          fs.writeFileSync(file, "partial", { flag: "w" });
          throw Error("write-failed private new-secret");
        }
        return fs.writeFileSync(file, contents, options);
      },
    };
    const env = {
      NODE_ENV: "production",
      LLM_PROVIDER: "gemini",
      GEMINI_LLM_MODEL_PREF: "gemini-old",
      GEMINI_API_KEY: "old-secret",
    };
    const module = { exports: {} };
    vm.runInNewContext(
      fs.readFileSync(
        path.resolve(__dirname, "../../../utils/helpers/updateENV.js"),
        "utf8"
      ),
      {
        module,
        exports: module.exports,
        __dirname: path.join(root, "utils", "helpers"),
        process: { env },
        console,
        Buffer,
        require: (name) =>
          name === "fs"
            ? mockFs
            : name === "../../models/telemetry"
              ? { Telemetry: {} }
              : name === "../vectorStore/resetAllVectorStores"
                ? {}
                : name === "../../models/eventLogs"
                  ? {
                      EventLogs: {
                        logEvent: async () => assert.fail("secret log"),
                      },
                    }
                  : require(name),
      }
    );
    try {
      if (mode === "restore-failure") {
        const { api } = setup(undefined, {
          env,
          persist: (values) =>
            module.exports.updateENV(values, false, 1, { atomicDump: true }),
        });
        const before = { ...env };
        const res = await save(api, api.revision(), { apiKey: "new-secret" });
        assert.equal(res.body.ok, false);
        assert.equal(res.body.code, "storage_failed");
        assert.deepEqual(env, before);
        assert.doesNotMatch(
          JSON.stringify(res.body),
          /old-secret|new-secret|write-failed/
        );
        assert.match(res.body.message, /기술 담당자/);
      } else if (mode === "write-failure") {
        await assert.rejects(
          () =>
            module.exports.updateENV(
              { GeminiLLMApiKey: "new-secret" },
              false,
              1,
              { atomicDump: true }
            ),
          (error) =>
            error.code === "ENV_WRITE_FAILED" && !/secret/.test(error.message)
        );
        assert.equal(fs.readFileSync(envPath, "utf8"), original);
      } else {
        await module.exports.updateENV(
          { GeminiLLMApiKey: "new-secret" },
          false,
          1,
          { atomicDump: true }
        );
        assert.match(
          fs.readFileSync(envPath, "utf8"),
          /GEMINI_API_KEY='new-secret'/
        );
        assert.doesNotMatch(fs.readFileSync(envPath, "utf8"), /old-secret/);
      }
      assert.deepEqual(fs.readdirSync(root), [".env"]);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }
});
