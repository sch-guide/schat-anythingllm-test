import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import { transformSync } from "esbuild";
const require = createRequire(import.meta.url);
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
function load(relative, deps = {}) {
  const module = { exports: {} };
  const code = transformSync(
    readFileSync(new URL(relative, import.meta.url), "utf8"),
    {
      loader: relative.endsWith("jsx") ? "jsx" : "js",
      format: "cjs",
      jsx: "automatic",
    }
  ).code;
  vm.runInNewContext(code, {
    module,
    exports: module.exports,
    console,
    setTimeout,
    clearTimeout,
    Date,
    window: { dispatchEvent() {} },
    CustomEvent: class {},
    require: (name) =>
      name in deps
        ? Object.hasOwn(deps[name], "default")
          ? { __esModule: true, ...deps[name] }
          : deps[name]
        : require(name),
  });
  return module.exports;
}
const initial = {
  logo: null,
  subtitle: "병원 실무지침 AI",
  announcement: { enabled: false, text: "", start: "", end: "" },
  welcome: { text: "오늘 어떻게 도와드릴까요?", examples: [] },
};
function controller(api = {}) {
  return load("./brandController.js", {
    "@/utils/schatBrand": rules(),
  }).createBrandEditor({ read: async () => structuredClone(initial), ...api });
}
function rules() {
  return load("../../utils/schatBrand.js");
}
test("로고 선택 전에 파일 종류·크기를 검사하고 읽기 실패시 기존 미리보기를 보존함", async () => {
  const c = controller();
  await c.start();
  await c.chooseLogo({ name: "a.png", type: "image/png", size: 1048577 });
  assert.match(c.getSnapshot().error, /1MB/);
  await c.chooseLogo({ name: "a.html", type: "text/html", size: 3 });
  assert.match(c.getSnapshot().error, /PNG|SVG/);
  await c.chooseLogo(
    { name: "a.png", type: "image/png", size: 100 },
    async () => {
      throw Error("파일 읽기 실패");
    }
  );
  assert.equal(c.getSnapshot().draft.logo, null);
});
test("미리보기는 저장 전만 바뀌며 API 실패에는 저장값이 유지되고 항목별 초기화함", async () => {
  let fail = false;
  const saved = structuredClone(initial);
  const c = controller({
    save: async (section, value, reset) => {
      if (fail) throw Error("저장 실패");
      saved[section] = reset ? initial[section] : value;
      return structuredClone(saved);
    },
  });
  await c.start();
  c.change("subtitle", "새 부제목");
  fail = true;
  await c.save("subtitle");
  assert.equal(c.getSnapshot().brand.subtitle, "병원 실무지침 AI");
  assert.equal(c.getSnapshot().draft.subtitle, "새 부제목");
  fail = false;
  await c.save("subtitle");
  assert.equal(c.getSnapshot().brand.subtitle, "새 부제목");
  c.change("welcome", { text: "새 안내", examples: ["새 질문"] });
  await c.save("welcome");
  await c.save("subtitle", true);
  assert.equal(c.getSnapshot().brand.subtitle, "병원 실무지침 AI");
  assert.deepEqual(Array.from(c.getSnapshot().brand.welcome.examples), [
    "새 질문",
  ]);
});
test("한국시간 입력을 UTC로 바꾸며 예약 시작 포함·종료 제외 경계를 계산함", () => {
  const r = rules();
  assert.equal(
    r.fromKoreaInput("2026-10-11T09:00"),
    "2026-10-11T00:00:00.000Z"
  );
  assert.equal(r.toKoreaInput("2026-10-11T00:00:00.000Z"), "2026-10-11T09:00");
  const a = {
    enabled: true,
    text: "공지",
    start: "2026-10-11T00:00:00Z",
    end: "2026-10-11T01:00:00Z",
  };
  assert.equal(r.announcementActive(a, Date.parse(a.start) - 1), false);
  assert.equal(r.announcementActive(a, Date.parse(a.start)), true);
  assert.equal(r.announcementActive(a, Date.parse(a.end)), false);
});
test("실제 관리자 React 화면의 파일선택·공지·저장·초기화가 처리기에 연결됨", async () => {
  const c = controller({
    save: async (section, value) => ({ ...initial, [section]: value }),
  });
  await c.start();
  const ui = load("./ui.jsx");
  const view = load("./sections/Brand.jsx", {
    "@/models/admin": { default: {} },
    "@/models/system": { default: {} },
    "@/models/workspace": { default: {} },
    "@/utils/toast": { default() {} },
    "@/components/SchLogo": { default: () => null },
    "@/components/Sidebar/ActiveWorkspaces": {
      REFETCH_WORKSPACES_EVENT: "test",
    },
    "../ui": ui,
    "../brandController": { createBrandEditor() {} },
    "@/models/schatBrand": { default: {} },
    "@/utils/schatBrand": rules(),
  });
  const tree = () =>
    view.BrandEditorView({ controller: c, state: c.getSnapshot() });
  function find(el, predicate) {
    if (!React.isValidElement(el)) return null;
    if (predicate(el)) return el;
    for (const child of React.Children.toArray(el.props.children)) {
      const found = find(child, predicate);
      if (found) return found;
    }
    return null;
  }
  const html = renderToStaticMarkup(tree());
  assert.match(html, /accept="\.png,\.svg,image\/png,image\/svg\+xml"/);
  assert.match(html, /한국 시간/);
  assert.equal((html.match(/>원래대로<\/button>/g) || []).length, 4);
  find(tree(), (el) => el.props.id === "brand-subtitle").props.onChange({
    target: { value: "시험 부제목" },
  });
  const subtitle = find(
    tree(),
    (el) => el.props["data-brand-section"] === "subtitle"
  );
  await subtitle.props.onSubmit({ preventDefault() {} });
  assert.equal(c.getSnapshot().brand.subtitle, "시험 부제목");
  const checkbox = find(tree(), (el) => el.props.id === "brand-notice-enabled");
  checkbox.props.onChange({ target: { checked: true } });
  assert.equal(c.getSnapshot().draft.announcement.enabled, true);
});
test("직원 공지는 HTML을 글자로 표시하며 열린 화면의 종료 시각에 자동으로 사라짐", async () => {
  const { createBrandStore } = load("../../hooks/useSchatBrand.js", {
    "@/models/schatBrand": { default: {} },
    "@/utils/schatBrand": rules(),
  });
  let now = 0;
  const timers = new Map();
  let id = 0;
  const brand = {
    ...initial,
    announcement: {
      enabled: true,
      text: "<b>공지</b>",
      start: "1970-01-01T00:00:01Z",
      end: "1970-01-01T00:00:02Z",
    },
  };
  const store = createBrandStore(
    { read: async () => brand },
    {
      now: () => now,
      setTimeout: (fn, ms) => {
        timers.set(++id, { fn, at: now + ms });
        return id;
      },
      clearTimeout: (id) => timers.delete(id),
    }
  );
  const stop = store.subscribe(() => {});
  await store.refresh();
  const view = load("../../components/SchatBrandContent.jsx", {
    "@/hooks/useSchatBrand": { default: () => store.getSnapshot() },
    "@/utils/schatBrand": rules(),
    "@/components/lib/SuggestedMessages": { default: () => null },
  });
  const html = () =>
    renderToStaticMarkup(React.createElement(view.BrandAnnouncement));
  assert.equal(html(), "");
  async function advance(to) {
    now = to;
    for (const [key, timer] of [...timers])
      if (timer.at <= now) {
        timers.delete(key);
        timer.fn();
      }
    await Promise.resolve();
  }
  await advance(1000);
  assert.match(html(), /&lt;b&gt;공지&lt;\/b&gt;/);
  assert.doesNotMatch(html(), /<b>/);
  await advance(2000);
  assert.equal(html(), "");
  stop();
  assert.equal(timers.size, 0);
});
test("공용 로고는 업로드한 이미지 전체를 크기에 맞추고 초기화시 SCH 원본으로 복귀함", () => {
  let brand = { ...initial, logo: "data:image/png;base64,test" };
  const view = load("../../components/SchLogo/index.jsx", {
    "@/media/logo/sch-logo.png": { default: "default.png" },
    "@/hooks/useSchatBrand": { default: () => ({ brand }) },
  });
  const html = () =>
    renderToStaticMarkup(
      React.createElement(view.default, { className: "h-8" })
    );
  assert.match(html(), /src="data:image\/png;base64,test"/);
  assert.match(html(), /object-contain/);
  assert.doesNotMatch(html(), /class="sch-logo /);
  brand = initial;
  assert.match(html(), /src="default.png"/);
});
test("예시 질문 빈 줄은 제거되어 기존 작업공간 예시로 되돌릴 수 있음", async () => {
  let result;
  const c = controller({
    save: async (_, value) => {
      result = value;
      return { ...initial, welcome: value };
    },
  });
  await c.start();
  c.change("welcome", { text: " 안내 ", examples: ["", "  "] });
  await c.save("welcome");
  assert.deepEqual(Array.from(result.examples), []);
});
test("로그인 양쪽 부제목에 관리자 문구가 일반 글자로 표시됨", () => {
  const view = load("../../components/Modals/Password/index.jsx", {
    "../../../models/system": { default: {} },
    "./SingleUserAuth": { default: () => null },
    "./MultiUserAuth": { default: () => null },
    "../../../utils/constants": {},
    "@/components/SchLogo": { default: () => null },
    "@/hooks/useSchatBrand": {
      default: () => ({ brand: { ...initial, subtitle: "수술 안내 & 근거" } }),
    },
  });
  const html = renderToStaticMarkup(React.createElement(view.default));
  assert.equal((html.match(/수술 안내 &amp; 근거/g) || []).length, 2);
});
test("브랜드 상세 조건은 짧은 소개와 분리된 키보드 도움말에 표시됨", async () => {
  const c = controller();
  await c.start();
  const ui = load("./ui.jsx");
  const view = load("./sections/Brand.jsx", {
    "@/models/admin": { default: {} },
    "@/models/system": { default: {} },
    "@/models/workspace": { default: {} },
    "@/utils/toast": { default() {} },
    "@/components/SchLogo": { default: () => null },
    "@/components/Sidebar/ActiveWorkspaces": {
      REFETCH_WORKSPACES_EVENT: "test",
    },
    "../ui": ui,
    "../brandController": { createBrandEditor() {} },
    "@/models/schatBrand": { default: {} },
    "@/utils/schatBrand": rules(),
  });
  const html = renderToStaticMarkup(
    view.BrandEditorView({ controller: c, state: c.getSnapshot() })
  );
  assert.equal((html.match(/aria-describedby=/g) || []).length, 4);
  const sections = html.split("<section").slice(1);
  for (const section of sections) {
    assert.match(section, /role="tooltip"/);
    const description = section.match(/<p[^>]*>(.*?)<\/p>/s)?.[1] || "";
    assert.ok(description.length <= 55);
  }
});
