const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function core() {
  return require("../../utils/schatBrand");
}
const png =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j5ZkAAAAASUVORK5CYII=";
const svg = (text) =>
  `data:image/svg+xml;base64,${Buffer.from(text).toString("base64")}`;
test("실제 PNG와 실행 기능 없는 SVG만 받아 크기·위장파일·외부참조를 거부함", () => {
  const { validateLogo } = core();
  assert.equal(validateLogo(png), png);
  assert.equal(
    validateLogo(
      svg(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><path d="M0 0h10v10z" fill="#123456"/></svg>'
      )
    ).startsWith("data:image/svg+xml"),
    true
  );
  for (const text of [
    '<svg onload="alert(1)"></svg>',
    "<svg><script>alert(1)</script></svg>",
    '<svg><image href="https://example.invalid/a"/></svg>',
    '<svg><path fill="url(https://example.invalid/a)"/></svg>',
    '<svg><style>@import "https://example.invalid/a"</style></svg>',
    '<!DOCTYPE svg [<!ENTITY x SYSTEM "file:///etc/passwd">]><svg>&x;</svg>',
    '<svg><foreignObject><iframe src="x"/></foreignObject></svg>',
    '<svg><animate attributeName="href" to="javascript:alert(1)"/></svg>',
  ])
    assert.throws(() => validateLogo(svg(text)), /로고|SVG/);
  assert.throws(
    () => validateLogo(svg(`<svg>${" ".repeat(1024 * 1024)}</svg>`)),
    /1MB/
  );
  assert.throws(
    () =>
      validateLogo(
        "data:image/png;base64," + Buffer.from("not a png").toString("base64")
      ),
    /PNG/
  );
});

test("예약 공지는 한국시간 시작 포함·종료 제외이며 끄면 숨겨짐", () => {
  const { announcementActive } = core();
  const notice = {
    enabled: true,
    text: "점검 안내",
    start: "2026-10-11T09:00:00+09:00",
    end: "2026-10-11T10:00:00+09:00",
  };
  assert.equal(
    announcementActive(notice, Date.parse("2026-10-11T08:59:59+09:00")),
    false
  );
  assert.equal(
    announcementActive(notice, Date.parse("2026-10-11T09:00:00+09:00")),
    true
  );
  assert.equal(
    announcementActive(notice, Date.parse("2026-10-11T10:00:00+09:00")),
    false
  );
  assert.equal(
    announcementActive({ ...notice, enabled: false }, Date.parse(notice.start)),
    false
  );
});

function setup(role = "admin") {
  let value = null;
  let fail = false;
  const settings = {
    get: async ({ label }) =>
      label === "schat_brand" ? { value } : { value: "secret" },
    _updateSettings: async (updates) => {
      if (fail) return { success: false };
      value = updates.schat_brand;
      return { success: true };
    },
    isMultiUserMode: async () => true,
  };
  const root = path.resolve(__dirname, "../..");
  function load(file, deps) {
    const module = { exports: {} };
    vm.runInNewContext(fs.readFileSync(path.join(root, file), "utf8"), {
      module,
      exports: module.exports,
      console,
      require: (name) => {
        if (name in deps) return deps[name];
        throw Error(`Unexpected: ${name}`);
      },
    });
    return module.exports;
  }
  const roles = load("utils/middleware/multiUserProtected.js", {
    "../../models/systemSettings": { SystemSettings: settings },
    "../http": { userFromSession: async (_, res) => res.locals.user },
  });
  const routes = {};
  load("endpoints/schatBrand.js", {
    "../models/systemSettings": { SystemSettings: settings },
    "../utils/schatBrand": core(),
    "../utils/http": { reqBody: (r) => r.body },
    "../utils/middleware/validatedRequest": {
      validatedRequest: (_, r, next) => {
        r.locals = { user: { role }, multiUserMode: true };
        next();
      },
    },
    "../utils/middleware/multiUserProtected": roles,
  }).schatBrandEndpoints({
    get: (r, ...h) => (routes["GET " + r] = h.flat()),
    put: (r, ...h) => (routes["PUT " + r] = h.flat()),
  });
  return {
    fail: () => (fail = true),
    raw: () => value,
    async invoke(method, body) {
      const res = {
        locals: {},
        statusCode: 200,
        status(c) {
          this.statusCode = c;
          return this;
        },
        set() {
          return this;
        },
        sendStatus(c) {
          this.statusCode = c;
          return this;
        },
        end() {
          return this;
        },
        json(v) {
          this.body = v;
          return this;
        },
      };
      for (const h of routes[method + " /system/schat-brand"]) {
        let next = false;
        await h({ body }, res, () => (next = true));
        if (!next) break;
      }
      return res;
    },
  };
}
test("관리자 저장·재조회·그룹별 초기화와 실패시 이전 값 보존", async () => {
  const s = setup();
  assert.equal(
    (await s.invoke("PUT", { section: "subtitle", value: "검사 안내" }))
      .statusCode,
    200
  );
  assert.equal((await s.invoke("GET")).body.brand.subtitle, "검사 안내");
  await s.invoke("PUT", {
    section: "welcome",
    value: { text: "안내", examples: ["질문 1"] },
  });
  await s.invoke("PUT", { section: "subtitle", reset: true });
  assert.equal((await s.invoke("GET")).body.brand.subtitle, "병원 실무지침 AI");
  assert.deepEqual(
    Array.from((await s.invoke("GET")).body.brand.welcome.examples),
    ["질문 1"]
  );
  const previous = s.raw();
  s.fail();
  assert.equal(
    (await s.invoke("PUT", { section: "subtitle", value: "실패" })).statusCode,
    503
  );
  assert.equal(s.raw(), previous);
});
test("직원은 브랜드 공개값만 읽으며 저장·HTML·잘못된 예약은 거부됨", async () => {
  const s = setup("default");
  const read = await s.invoke("GET");
  assert.deepEqual(Object.keys(read.body), ["brand"]);
  assert.equal(JSON.stringify(read.body).includes("secret"), false);
  assert.equal(
    (await s.invoke("PUT", { section: "subtitle", value: "변경" })).statusCode,
    401
  );
  const admin = setup();
  for (const body of [
    { section: "subtitle", value: "<img src=x onerror=alert(1)>" },
    { section: "api_key", value: "secret" },
    {
      section: "announcement",
      value: {
        enabled: true,
        text: "공지",
        start: "2026-10-11T10:00+09:00",
        end: "2026-10-11T09:00+09:00",
      },
    },
  ])
    assert.equal((await admin.invoke("PUT", body)).statusCode, 400);
});
test("로고 저장 재조회·악성파일 실패 보존과 공지·로고·첫화면 각각 초기화함", async () => {
  const s = setup();
  assert.equal(
    (await s.invoke("PUT", { section: "logo", value: png })).statusCode,
    200
  );
  assert.equal((await s.invoke("GET")).body.brand.logo, png);
  const previous = s.raw();
  assert.equal(
    (
      await s.invoke("PUT", {
        section: "logo",
        value: svg('<svg onload="alert(1)"/>'),
      })
    ).statusCode,
    400
  );
  assert.equal(s.raw(), previous);
  await s.invoke("PUT", {
    section: "announcement",
    value: { enabled: true, text: "공지", start: "", end: "" },
  });
  await s.invoke("PUT", {
    section: "welcome",
    value: { text: "새 안내", examples: ["질문"] },
  });
  await s.invoke("PUT", { section: "logo", reset: true });
  assert.equal((await s.invoke("GET")).body.brand.logo, null);
  assert.equal((await s.invoke("GET")).body.brand.announcement.enabled, true);
  await s.invoke("PUT", { section: "announcement", reset: true });
  assert.equal((await s.invoke("GET")).body.brand.announcement.enabled, false);
  await s.invoke("PUT", { section: "welcome", reset: true });
  assert.equal(
    (await s.invoke("GET")).body.brand.welcome.text,
    "오늘 어떻게 도와드릴까요?"
  );
});
