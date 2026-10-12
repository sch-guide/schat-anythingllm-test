const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function core() {
  return require("../../utils/schatBrand");
}
const png =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=";
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

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++)
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function pngWith({
  depth = 8,
  color = 6,
  raw = Buffer.from([0, 255, 0, 0, 255]),
  compressed,
  interlace = 0,
} = {}) {
  const chunk = (type, data) => {
    const result = Buffer.alloc(data.length + 12);
    result.writeUInt32BE(data.length);
    result.write(type, 4);
    data.copy(result, 8);
    result.writeUInt32BE(crc32(result.subarray(4, -4)), result.length - 4);
    return result;
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(1);
  header.writeUInt32BE(1, 4);
  header[8] = depth;
  header[9] = color;
  header[12] = interlace;
  return Buffer.concat([
    Buffer.from("89504e470d0a1a0a", "hex"),
    chunk("IHDR", header),
    chunk("IDAT", compressed || require("node:zlib").deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
const pngUrl = (bytes) => `data:image/png;base64,${bytes.toString("base64")}`;
test("PNG 비트깊이·색상·CRC·압축데이터·픽셀길이·필터 손상을 거부하고 이전 로고를 보존함", async () => {
  const s = setup();
  await s.invoke("PUT", { section: "logo", value: png });
  const previous = s.raw();
  const corruptCrc = pngWith();
  corruptCrc[29] ^= 1;
  const invalid = [
    pngWith({ depth: 0 }),
    pngWith({ color: 1 }),
    corruptCrc,
    pngWith({ compressed: Buffer.from([1, 2, 3]) }),
    pngWith({ raw: Buffer.from([0]) }),
    pngWith({ raw: Buffer.from([5, 255, 0, 0, 255]) }),
    pngWith({ depth: 1, color: 3, raw: Buffer.from([0, 0]) }),
  ];
  for (const bytes of invalid) {
    assert.throws(() => core().validateLogo(pngUrl(bytes)), /PNG/);
    assert.equal(
      (await s.invoke("PUT", { section: "logo", value: pngUrl(bytes) }))
        .statusCode,
      400
    );
    assert.equal(s.raw(), previous);
  }
  assert.equal(core().validateLogo(pngUrl(pngWith())), pngUrl(pngWith()));
  assert.equal(
    core().validateLogo(pngUrl(pngWith({ interlace: 1 }))),
    pngUrl(pngWith({ interlace: 1 }))
  );
  const original = fs.readFileSync(
    path.resolve(__dirname, "../../../frontend/src/media/logo/sch-logo.png")
  );
  assert.equal(core().validateLogo(pngUrl(original)), pngUrl(original));
});
test("공지 제목은 8자까지 저장하고, 예전 공지와 초기화는 공지사항 제목을 씀", async () => {
  const { validateSection, publicBrand, defaults } = core();
  const notice = (title) =>
    validateSection("announcement", {
      enabled: true,
      text: "시스템 점검",
      start: "",
      end: "",
      ...(title === undefined ? {} : { title }),
    });
  assert.equal(notice(undefined).title, "공지사항");
  assert.equal(notice(" 점검 ").title, "점검");
  // 비워 두면 그대로 저장하고, 화면에서 공지사항으로 보여 준다.
  assert.equal(notice("").title, "");
  assert.equal(notice("12345678").title, "12345678");
  assert.throws(() => notice("123456789"), /길이 제한/);
  assert.throws(() => notice("<b>알림</b>"), /일반 글자/);
  // a notice saved before the title existed
  const old = publicBrand(
    JSON.stringify({
      announcement: { enabled: true, text: "공지", start: "", end: "" },
    })
  );
  assert.equal(old.announcement.title, "공지사항");
  assert.equal(defaults().announcement.title, "공지사항");
  const s = setup();
  await s.invoke("PUT", {
    section: "announcement",
    value: { enabled: true, title: "알림", text: "공지", start: "", end: "" },
  });
  assert.equal((await s.invoke("GET")).body.brand.announcement.title, "알림");
  await s.invoke("PUT", { section: "announcement", reset: true });
  assert.equal(
    (await s.invoke("GET")).body.brand.announcement.title,
    "공지사항"
  );
});

test("소속 표시: 기본값 간호교육파트, 12자 이하, 비우기 허용, 예전 설정에는 기본값", () => {
  const brand = require("../../utils/schatBrand");
  assert.equal(brand.defaults().affiliation, "간호교육파트");
  assert.equal(brand.publicBrand("{}").affiliation, "간호교육파트");
  assert.equal(brand.publicBrand(JSON.stringify({ subtitle: "가짜" })).affiliation, "간호교육파트");
  assert.equal(brand.publicBrand(JSON.stringify({ affiliation: "" })).affiliation, "");
  assert.equal(brand.validateSection("affiliation", " 간호부 "), "간호부");
  assert.equal(brand.validateSection("affiliation", "가".repeat(12)), "가".repeat(12));
  assert.throws(() => brand.validateSection("affiliation", "가".repeat(13)));
  assert.throws(() => brand.validateSection("affiliation", "<b>x</b>"));
});
