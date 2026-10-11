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
function noticeView(brand = initial) {
  return load("../../components/SchatBrandContent.jsx", {
    "@/hooks/useSchatBrand": { default: () => ({ brand, now: Date.now() }) },
    "@/utils/schatBrand": rules(),
    "@/components/lib/SuggestedMessages": { default: () => null },
  });
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
    "@/components/SchatBrandContent": noticeView(),
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
  assert.doesNotMatch(html, /한국 시간|열린 화면에서도 종료 시간에 숨겨요/);
  assert.equal(
    html.match(/<label[^>]*for="brand-notice-start"[^>]*>(.*?)<\/label>/s)?.[1],
    "시작 일시"
  );
  assert.equal(
    html.match(/<label[^>]*for="brand-notice-end"[^>]*>(.*?)<\/label>/s)?.[1],
    "종료 일시"
  );
  // 4 sections + the notice title's own [원래대로]
  assert.equal((html.match(/>원래대로<\/button>/g) || []).length, 5);
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
  find(tree(), (el) => el.props.id === "brand-notice-start").props.onChange({
    target: { value: "2026-10-11T09:00" },
  });
  find(tree(), (el) => el.props.id === "brand-notice-end").props.onChange({
    target: { value: "2026-10-11T10:00" },
  });
  assert.equal(
    c.getSnapshot().draft.announcement.start,
    "2026-10-11T00:00:00.000Z"
  );
  assert.equal(
    c.getSnapshot().draft.announcement.end,
    "2026-10-11T01:00:00.000Z"
  );
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
    "@/components/SchatBrandContent": noticeView(),
  });
  const html = renderToStaticMarkup(
    view.BrandEditorView({ controller: c, state: c.getSnapshot() })
  );
  assert.equal((html.match(/aria-expanded="false"/g) || []).length, 4);
  assert.equal((html.match(/aria-controls=/g) || []).length, 4);
  const sections = html.split("<section").slice(1);
  for (const section of sections) {
    assert.match(section, /role="region"/);
    assert.match(section, /hidden=""/);
    assert.ok((section.match(/<li>/g) || []).length >= 2);
    assert.ok((section.match(/<li>/g) || []).length <= 3);
    const description = section.match(/<p[^>]*>(.*?)<\/p>/s)?.[1] || "";
    assert.ok(description.length <= 55);
  }
});
test("공지 띠: 제목 기본값, ✕는 그날만 숨김, 제목·내용이 바뀌면 다시 보임", () => {
  const r = rules();
  assert.equal(r.noticeTitle({ title: "" }), "공지사항");
  assert.equal(r.noticeTitle({}), "공지사항");
  assert.equal(r.noticeTitle({ title: " 점검 " }), "점검");
  const store = new Map();
  const storage = {
    getItem: (k) => store.get(k) ?? null,
    setItem: (k, v) => store.set(k, v),
  };
  const notice = { title: "알림", text: "10일 점검" };
  const today = new Date(2026, 9, 11, 9, 0);
  const tonight = new Date(2026, 9, 11, 23, 59);
  const tomorrow = new Date(2026, 9, 12, 0, 1);
  assert.equal(r.noticeDismissed(notice, { storage, now: today }), false);
  r.dismissNotice(notice, { storage, now: today });
  assert.equal(r.noticeDismissed(notice, { storage, now: tonight }), true);
  assert.equal(r.noticeDismissed(notice, { storage, now: tomorrow }), false);
  assert.equal(
    r.noticeDismissed(
      { ...notice, text: "11일 점검" },
      { storage, now: today }
    ),
    false
  );
  assert.equal(
    r.noticeDismissed({ ...notice, title: "안내" }, { storage, now: today }),
    false
  );
  // storage that throws (private window) never breaks the screen
  const broken = {
    getItem() {
      throw Error("blocked");
    },
    setItem() {
      throw Error("blocked");
    },
  };
  assert.equal(r.noticeDismissed(notice, { storage: broken }), false);
  r.dismissNotice(notice, { storage: broken });
  // about 50px a second, including the gap before the text repeats
  assert.equal(r.noticeScrollSeconds(952), 20);
});

test("공지 저장 실패: 이번 탭에서 닫힘을 유지하고 제목·내용·날짜가 바뀌면 다시 보임", () => {
  const notice = { title: "알림", text: "점검 안내" };
  const today = new Date(2026, 9, 11, 9);
  const tonight = new Date(2026, 9, 11, 23, 59);
  const tomorrow = new Date(2026, 9, 12, 0, 1);
  for (const storage of [
    null,
    {
      getItem() {
        throw Error("blocked");
      },
      setItem() {
        throw Error("blocked");
      },
    },
    {
      getItem() {
        return null;
      },
      setItem() {
        throw Error("quota exceeded");
      },
    },
  ]) {
    const r = rules();
    r.dismissNotice(notice, { storage, now: today });
    assert.equal(r.noticeDismissed(notice, { storage, now: tonight }), true);
    assert.equal(
      r.noticeDismissed({ ...notice, title: "안내" }, { storage, now: today }),
      false
    );
    assert.equal(
      r.noticeDismissed(
        { ...notice, text: "새 점검 안내" },
        { storage, now: today }
      ),
      false
    );
    assert.equal(r.noticeDismissed(notice, { storage, now: tomorrow }), false);
    // 저장하지 못한 닫힘은 새로고침에 해당하는 새 모듈에는 남지 않는다.
    assert.equal(
      rules().noticeDismissed(notice, { storage, now: today }),
      false
    );
  }
});

test("공지 저장 성공: 새로고침 뒤에도 오늘 숨김을 읽음", () => {
  const store = new Map();
  const storage = {
    getItem: (key) => store.get(key),
    setItem: (key, value) => store.set(key, value),
  };
  const notice = { title: "알림", text: "점검 안내" };
  const now = new Date(2026, 9, 11, 9);
  rules().dismissNotice(notice, { storage, now });
  assert.equal(rules().noticeDismissed(notice, { storage, now }), true);
});

test("공지 띠 모양: 아이콘·제목·구분선·글·✕, 자세히 보기 없음, 버튼과 대화는 띠만큼 내려감", () => {
  const brand = {
    ...initial,
    announcement: {
      enabled: true,
      title: "",
      text: "오늘 18시 시스템 점검",
      start: "",
      end: "",
    },
  };
  const view = noticeView(brand);
  const html = renderToStaticMarkup(
    React.createElement(view.BrandAnnouncement)
  );
  assert.match(html, /📢/);
  assert.match(html, /<strong[^>]*color:#0f766e[^>]*>공지사항<\/strong>/);
  assert.match(html, /background:#ecfdf8/);
  assert.match(html, /border-color:#bfe8dc/);
  assert.match(html, /오늘 18시 시스템 점검/);
  assert.match(html, /aria-label="공지 닫기"/);
  assert.doesNotMatch(html, /자세히 보기/);
  assert.ok(
    html.indexOf("📢") < html.indexOf("공지사항") &&
      html.indexOf("공지사항") < html.indexOf("오늘 18시") &&
      html.indexOf("오늘 18시") < html.indexOf("공지 닫기")
  );
  // no notice: the panel keeps its old position (0px)
  assert.equal(
    view.useBrandPanelStyle().paddingTop,
    "var(--schat-notice-h, 0px)"
  );
  const off = noticeView(initial);
  assert.equal(
    renderToStaticMarkup(React.createElement(off.BrandAnnouncement)),
    ""
  );
  for (const file of [
    "../../components/UserMenu/UserButton/index.jsx",
    "../../components/WorkspaceChat/ChatContainer/ChatSettingsMenu/index.jsx",
  ])
    assert.match(
      readFileSync(new URL(file, import.meta.url), "utf8"),
      /md:top-\[calc\([0-9.]+rem_\+_var\(--schat-notice-h,0px\)\)\]/
    );
});

test("관리자 공지: 제목칸(8자)·원래대로·실제 띠 미리보기", async () => {
  const c = controller();
  await c.start();
  const view = load("./sections/Brand.jsx", {
    "@/models/admin": { default: {} },
    "@/models/system": { default: {} },
    "@/models/workspace": { default: {} },
    "@/utils/toast": { default() {} },
    "@/components/SchLogo": { default: () => null },
    "@/components/Sidebar/ActiveWorkspaces": {
      REFETCH_WORKSPACES_EVENT: "test",
    },
    "../ui": load("./ui.jsx"),
    "../brandController": { createBrandEditor() {} },
    "@/models/schatBrand": { default: {} },
    "@/utils/schatBrand": rules(),
    "@/components/SchatBrandContent": noticeView(),
  });
  const render = () =>
    renderToStaticMarkup(
      view.BrandEditorView({ controller: c, state: c.getSnapshot() })
    );
  assert.match(
    render(),
    /id="brand-notice-title"[^>]*maxLength="8"|maxLength="8"[^>]*id="brand-notice-title"/i
  );
  assert.match(render(), /data-notice-preview/);
  c.change("announcement", {
    ...c.getSnapshot().draft.announcement,
    title: "점검",
    text: "18시 점검",
  });
  assert.match(render(), /<strong[^>]*>점검<\/strong>/);
  assert.match(render(), /18시 점검/);
  c.change("announcement", {
    ...c.getSnapshot().draft.announcement,
    title: "",
  });
  assert.match(render(), /<strong[^>]*>공지사항<\/strong>/);
});

test("브랜드 저장소의 기본 시계는 브라우저 타이머를 원래 대상으로 호출함", async () => {
  // Browsers throw "Illegal invocation" when setTimeout/clearTimeout run with
  // another object as `this`; that broke the whole employee chat page.
  const strict = {
    setTimeout(fn, ms) {
      if (this !== undefined && this !== strict)
        throw TypeError("Illegal invocation");
      return setTimeout(fn, ms);
    },
    clearTimeout(id) {
      if (this !== undefined && this !== strict)
        throw TypeError("Illegal invocation");
      return clearTimeout(id);
    },
  };
  const module = { exports: {} };
  const code = transformSync(
    readFileSync(
      new URL("../../hooks/useSchatBrand.js", import.meta.url),
      "utf8"
    ),
    { loader: "js", format: "cjs" }
  ).code;
  vm.runInNewContext(code, {
    module,
    exports: module.exports,
    Date,
    setTimeout: strict.setTimeout,
    clearTimeout: strict.clearTimeout,
    window: { addEventListener() {}, removeEventListener() {} },
    require: (name) =>
      name === "@/models/schatBrand"
        ? { __esModule: true, default: { read: async () => initial } }
        : name === "@/utils/schatBrand"
          ? rules()
          : require(name),
  });
  const store = module.exports.createBrandStore({
    read: async () => ({
      ...initial,
      announcement: {
        enabled: true,
        text: "공지",
        start: "",
        end: new Date(Date.now() + 60000).toISOString(),
      },
    }),
  });
  const stop = store.subscribe(() => {});
  await store.refresh();
  stop();
});
