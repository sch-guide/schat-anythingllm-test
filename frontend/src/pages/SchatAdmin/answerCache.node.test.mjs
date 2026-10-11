import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import vm from "node:vm";
import { transformSync } from "esbuild";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");

const controllerUrl = new URL("./answerCacheController.js", import.meta.url);
const { createAnswerCacheController } = existsSync(controllerUrl)
  ? await import(controllerUrl)
  : {};
function controller(api, workspaceId = 1) {
  assert.equal(
    typeof createAnswerCacheController,
    "function",
    "화면 상태 처리가 구현되어야 함",
  );
  return createAnswerCacheController(api, workspaceId);
}
const report = {
  entries: [
    {
      id: "1",
      workspaceId: 1,
      question: "시험 질문",
      uses: 2,
      createdAt: 1728000000000,
    },
  ],
  stats: {
    entries: 1,
    savedAnswerCalls: 2,
    scope: "all-workspaces-since-start",
    maxEntries: 100,
  },
};
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

test("목록 조회 실패는 빈 목록으로 오인하지 않음", async () => {
  const state = controller({
    list: async () => {
      throw Error("조회 실패");
    },
  });
  await state.start();
  assert.equal(state.getSnapshot().data, null);
  assert.equal(state.getSnapshot().loading, false);
  assert.match(state.getSnapshot().error, /조회 실패/);
});
test("삭제 중 중복 요청을 막고 성공 뒤 다시 조회함", async () => {
  const deletion = deferred();
  let reads = 0;
  let deletes = 0;
  const state = controller({
    list: async (workspaceId) => {
      assert.equal(workspaceId, 1);
      reads++;
      return reads === 1 ? report : { ...report, entries: [] };
    },
    remove: async (workspaceId, id) => {
      assert.equal(workspaceId, 1);
      assert.equal(id, "1");
      deletes++;
      await deletion.promise;
    },
  });
  await state.start();
  const first = state.remove("1");
  assert.equal(state.getSnapshot().busy, true);
  assert.equal(await state.remove("1"), false);
  assert.equal(await state.load(), false);
  assert.equal(deletes, 1);
  deletion.resolve();
  await first;
  assert.equal(reads, 2);
  assert.equal(state.getSnapshot().data.entries.length, 0);
  assert.equal(state.getSnapshot().busy, false);
});
test("전체 비우기는 확인을 요구하고 전체 범위 API만 호출함", async () => {
  let cleared = 0;
  const state = controller({
    list: async () => report,
    clear: async () => {
      cleared++;
    },
  });
  await state.start();
  assert.equal(await state.clear(false), false);
  assert.equal(cleared, 0);
  assert.equal(await state.clear(true), true);
  assert.equal(cleared, 1);
});
test("삭제 실패는 항목을 유지하고 실패를 표시함", async () => {
  const state = controller({
    list: async () => report,
    remove: async () => {
      throw Error("삭제 실패");
    },
  });
  await state.start();
  assert.equal(await state.remove("1"), false);
  assert.equal(state.getSnapshot().data.entries.length, 1);
  assert.match(state.getSnapshot().error, /삭제 실패/);
  assert.equal(state.getSnapshot().busy, false);
});
test("삭제 후 재조회 실패를 0건으로 표시하지 않음", async () => {
  let reads = 0;
  const state = controller({
    list: async () => {
      if (++reads > 1) throw Error("조회 실패");
      return report;
    },
    remove: async () => {},
  });
  await state.start();
  await state.remove("1");
  assert.equal(state.getSnapshot().data, null);
  assert.match(state.getSnapshot().error, /조회 실패/);
  assert.match(state.getSnapshot().notice, /삭제/);
});
test("늦은 조회는 최신 조회나 다른 작업 공간 화면을 덮지 않음", async () => {
  const old = deferred();
  let reads = 0;
  const state = controller({
    list: async () =>
      ++reads === 1 ? old.promise : { ...report, entries: [] },
  });
  const first = state.start();
  await state.load();
  old.resolve(report);
  await first;
  assert.equal(state.getSnapshot().data.entries.length, 0);
  const pending = deferred();
  const oldWorkspace = controller({ list: async () => pending.promise });
  const oldRequest = oldWorkspace.start();
  oldWorkspace.stop();
  const nextWorkspace = controller(
    {
      list: async (id) => {
        assert.equal(id, 2);
        return { ...report, entries: [] };
      },
    },
    2,
  );
  await nextWorkspace.start();
  pending.resolve(report);
  await oldRequest;
  assert.equal(oldWorkspace.getSnapshot().data, null);
  assert.equal(nextWorkspace.getSnapshot().data.entries.length, 0);
});
test("StrictMode의 정리 후 재시작에도 이전 응답을 버리고 새 현황을 표시함", async () => {
  const old = deferred();
  let reads = 0;
  const state = controller({
    list: async () =>
      ++reads === 1 ? old.promise : { ...report, entries: [] },
  });
  const first = state.start();
  state.stop();
  await state.start();
  old.resolve(report);
  await first;
  assert.equal(state.getSnapshot().data.entries.length, 0);
});

function loadApi(fetch) {
  const url = new URL("../../models/answerCache.js", import.meta.url);
  assert.ok(existsSync(url), "캐시 API model이 구현되어야 함");
  const code = transformSync(readFileSync(url, "utf8"), { format: "cjs" }).code;
  const module = { exports: {} };
  vm.runInNewContext(code, {
    module,
    exports: module.exports,
    fetch,
    URLSearchParams,
    require: (name) =>
      name === "@/utils/constants"
        ? { API_BASE: "/api" }
        : { baseHeaders: () => ({ Authorization: "Bearer synthetic" }) },
  });
  return module.exports.default;
}
test("API model은 범위를 전달하고 JSON 확인 요청에 Content-Type을 명시함", async () => {
  const calls = [];
  const api = loadApi(async (url, options) => {
    calls.push({ url, options });
    return { ok: true, json: async () => report };
  });
  await api.list(2);
  await api.remove(2, "entry/3");
  await api.clear();
  assert.equal(calls[0].url, "/api/schat-admin/answer-cache?workspaceId=2");
  assert.equal(
    calls[1].url,
    "/api/schat-admin/answer-cache/entry%2F3?workspaceId=2",
  );
  assert.equal(calls[1].options.method, "DELETE");
  assert.equal(calls[2].url, "/api/schat-admin/answer-cache/clear");
  assert.equal(calls[2].options.headers["Content-Type"], "application/json");
  assert.equal(calls[2].options.headers.Authorization, "Bearer synthetic");
  assert.deepEqual(JSON.parse(calls[2].options.body), { confirm: true });
});
test("API model은 서버 실패와 잘못된 목록을 성공으로 취급하지 않음", async () => {
  const rejected = loadApi(async () => ({
    ok: false,
    json: async () => ({ error: "권한 없음" }),
  }));
  await assert.rejects(rejected.list(1), /권한 없음/);
  const malformed = loadApi(async () => ({ ok: true, json: async () => ({}) }));
  await assert.rejects(malformed.list(1));
});

function loadView(confirm = () => true) {
  const url = new URL("./sections/AnswerCache.jsx", import.meta.url);
  assert.ok(existsSync(url), "답변 재사용 화면이 구현되어야 함");
  const loadJsx = (url, deps) => {
    const module = { exports: {} };
    const code = transformSync(readFileSync(url, "utf8"), {
      format: "cjs",
      loader: "jsx",
      jsx: "automatic",
    }).code;
    vm.runInNewContext(code, {
      module,
      exports: module.exports,
      window: { confirm },
      require: (name) => (name in deps ? deps[name] : require(name)),
    });
    return module.exports;
  };
  const ui = loadJsx(new URL("./ui.jsx", import.meta.url), {});
  return loadJsx(url, {
    "../ui": ui,
    "@/models/answerCache": { default: {} },
    "../answerCacheController": { createAnswerCacheController },
  }).AnswerCacheView;
}
function findButton(element, label) {
  if (!React.isValidElement(element)) return null;
  const children = React.Children.toArray(element.props.children);
  if (element.type.name === "Button" && children.join("") === label)
    return element;
  for (const child of children) {
    const found = findButton(child, label);
    if (found) return found;
  }
  return null;
}
test("화면은 질문과 작업 공간·사용 횟수·저장 시각, 전역 누계 범위를 표시함", async () => {
  const state = controller({ list: async () => report });
  await state.start();
  const View = loadView();
  const html = renderToStaticMarkup(
    React.createElement(View, {
      controller: state,
      state: state.getSnapshot(),
      workspace: { name: "시험 부서" },
    }),
  );
  for (const value of [
    "시험 질문",
    "시험 부서",
    "사용 횟수",
    "저장 시각",
    "서버 시작 후 전체 작업 공간",
    "100개",
    "서버를 재시작",
    "안전한 독립 질문",
    "문서·대화 기록",
  ])
    assert.ok(html.includes(value), value);
  assert.equal(html.includes("전체 Gemini 비용"), false);
});
test("실제 화면의 삭제·새로고침·전체 확인 버튼이 상태 처리와 연결됨", async () => {
  let removed = 0;
  let cleared = 0;
  let reads = 0;
  let allow = false;
  let message = "";
  const state = controller({
    list: async () => {
      reads++;
      return report;
    },
    remove: async (id, entry) => {
      assert.equal(id, 1);
      assert.equal(entry, "1");
      removed++;
    },
    clear: async () => {
      cleared++;
    },
  });
  await state.start();
  const View = loadView((text) => {
    message = text;
    return allow;
  });
  const view = () =>
    View({
      controller: state,
      state: state.getSnapshot(),
      workspace: { name: "시험 부서" },
    });
  await findButton(view(), "삭제").props.onClick();
  assert.equal(removed, 1);
  await findButton(view(), "새로 고침").props.onClick();
  assert.equal(reads, 3);
  await findButton(view(), "모든 작업 공간의 저장본 비우기").props.onClick();
  assert.equal(cleared, 0);
  assert.match(message, /모든 작업 공간/);
  assert.match(message, /문서·대화 기록/);
  allow = true;
  await findButton(view(), "모든 작업 공간의 저장본 비우기").props.onClick();
  assert.equal(cleared, 1);
});
test("화면의 조회 실패는 0개 목록 대신 경고와 재시도 버튼을 표시함", async () => {
  const state = controller({
    list: async () => {
      throw Error("시험 조회 실패");
    },
  });
  await state.start();
  const View = loadView();
  const element = View({
    controller: state,
    state: state.getSnapshot(),
    workspace: { name: "시험 부서" },
  });
  const html = renderToStaticMarkup(element);
  assert.ok(html.includes("시험 조회 실패"));
  assert.equal(html.includes("저장된 질문이 없습니다"), false);
  assert.ok(findButton(element, "새로 고침"));
});

test("실제 설정 사이드바는 관리자에게만 새 항목과 유효한 아이콘을 표시함", async () => {
  const { StaticRouter } = require("react-router-dom/server");
  const menu = await import("./menu.js");
  const load = (relativePath, deps) => {
    const module = { exports: {} };
    const code = transformSync(
      readFileSync(new URL(relativePath, import.meta.url), "utf8"),
      { format: "cjs", loader: "jsx", jsx: "automatic" },
    ).code;
    vm.runInNewContext(code, {
      module,
      exports: module.exports,
      require: (name) => (name in deps ? deps[name] : require(name)),
    });
    return module.exports;
  };
  const paths = load("../../utils/paths.js", {
    "./constants": { API_BASE: "/api" },
  });
  const option = load("../../components/SettingsSidebar/MenuOption/index.jsx", {
    "@/utils/request": { safeJsonParse: JSON.parse },
    "@/utils/paths": paths,
    "@/hooks/useScrollActiveItemIntoView": {
      __esModule: true,
      default: () => ({ ref: null }),
    },
  });
  const render = (role) => {
    const sidebar = load("../../components/SettingsSidebar/index.jsx", {
      "@/utils/paths": paths,
      "../Sidebar/SchatBrand": { __esModule: true, default: () => null },
      "@/hooks/useUser": {
        __esModule: true,
        default: () => ({ user: { role } }),
      },
      "react-device-detect": { isMobile: false },
      "../Footer": { __esModule: true, default: () => null },
      "./MenuOption": option,
      "@/pages/SchatAdmin/menu": menu,
    });
    return renderToStaticMarkup(
      React.createElement(
        StaticRouter,
        { location: "/settings/schat/answer-cache" },
        React.createElement(sidebar.default),
      ),
    );
  };
  const admin = render("admin");
  assert.match(admin, /href="\/settings\/schat\/answer-cache"/);
  assert.ok(admin.includes("답변 재사용"));
  assert.equal(render("default").includes("답변 재사용"), false);
});
