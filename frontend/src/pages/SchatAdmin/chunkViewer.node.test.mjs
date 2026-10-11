import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import vm from "node:vm";
import { transformSync } from "esbuild";
import { createRequire } from "node:module";
import { createChunkViewerController } from "./chunkViewerController.js";
const require = createRequire(import.meta.url);
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
function make(api) {
  assert.equal(
    typeof createChunkViewerController,
    "function",
    "조회 화면 상태 처리가 필요함"
  );
  return createChunkViewerController(api, 1);
}
const empty = { items: [], hasMore: false, nextOffset: null };
test("도움말은 키보드로 접근할 버튼과 연결된 설명을 제공함", () => {
  const ui = load("./ui.jsx");
  const html = renderToStaticMarkup(React.createElement(ui.Help, null, "목록 순서 설명"));
  assert.match(html, /<button[^>]*aria-expanded="false"[^>]*aria-controls=/);
  assert.match(html, /hidden=""[^>]*role="region"/);
  assert.match(html, /목록 순서 설명/);
});
const docs = { ...empty, items: [{ documentId: "doc-a", name: "시험 문서" }] };
test("문서 선택·검색·다음/이전 페이지를 작업 공간 안에서 조회함", async () => {
  const calls = [];
  const state = make({
    documents: async () => docs,
    chats: async () => empty,
    chunks: async (ws, query) => {
      calls.push({ ws, ...query });
      return {
        ...empty,
        items: [{ id: "v" }],
        hasMore: true,
        nextOffset: query.offset === 0 ? 50 : 100,
      };
    },
  });
  await state.start();
  await state.search("바늘");
  await state.nextChunks();
  await state.previousChunks();
  assert.deepEqual(
    calls.map((c) => [c.ws, c.documentId, c.q, c.offset]),
    [
      [1, "doc-a", "", 0],
      [1, "doc-a", "바늘", 0],
      [1, "doc-a", "바늘", 50],
      [1, "doc-a", "바늘", 0],
    ]
  );
});
test("조회 실패와 늦은 응답은 빈 성공·새 문서 결과로 바뀌지 않음", async () => {
  let resolve;
  const old = new Promise((done) => (resolve = done));
  const state = make({
    documents: async () => docs,
    chats: async () => empty,
    chunks: async (_, q) =>
      q.q === "old"
        ? old
        : q.q === "bad"
          ? Promise.reject(Error("시험 실패"))
          : { ...empty, items: [{ id: "new" }] },
  });
  await state.start();
  const previous = state.search("old");
  await state.search("new");
  resolve({ ...empty, items: [{ id: "old" }] });
  await previous;
  assert.equal(state.getSnapshot().chunks.items[0].id, "new");
  await state.search("bad");
  assert.equal(state.getSnapshot().chunks, null);
  assert.match(state.getSnapshot().errors.chunks, /시험 실패/);
});
test("정리된 화면의 늦은 질문 근거는 다시 표시되지 않음", async () => {
  let resolve;
  const pending = new Promise((done) => (resolve = done));
  const state = make({
    documents: async () => empty,
    chats: async () => empty,
    chat: async () => pending,
  });
  await state.start();
  const request = state.openChat(7);
  state.stop();
  resolve({ sources: [] });
  await request;
  assert.equal(state.getSnapshot().detail, null);
});
test("질문 목록 페이지를 바꾸면 진행 중인 이전 근거와 오류를 지움", async () => {
  let resolve;
  const old = new Promise((done) => (resolve = done));
  const state = make({
    documents: async () => empty,
    chats: async () => empty,
    chat: async () => old,
  });
  await state.start();
  const request = state.openChat(7);
  await state.chatPage(50);
  assert.equal(state.getSnapshot().loading.detail, false);
  resolve({ sources: [{ name: "이전" }] });
  await request;
  assert.equal(state.getSnapshot().detail, null);
});
function load(relative, deps = {}, globals = {}) {
  const url = new URL(relative, import.meta.url);
  assert.ok(existsSync(url), "조회 화면 파일이 필요함");
  const module = { exports: {} };
  vm.runInNewContext(
    transformSync(readFileSync(url, "utf8"), {
      format: "cjs",
      loader: relative.endsWith("jsx") ? "jsx" : "js",
      jsx: "automatic",
    }).code,
    {
      module,
      exports: module.exports,
      URLSearchParams,
      ...globals,
      require: (name) => (name in deps ? deps[name] : require(name)),
    }
  );
  return module.exports;
}
test("근거 화면은 저장 발췌·실제 청크·버전 상태를 구분하고 HTML을 실행하지 않음", () => {
  const ui = load("./ui.jsx");
  const view = load("./sections/Chunks.jsx", {
    "../ui": ui,
    "@/models/chunkViewer": { default: {} },
    "../chunkViewerController": { createChunkViewerController },
  });
  const html = renderToStaticMarkup(
    React.createElement(view.ChatEvidence, {
      detail: {
        question: "시험",
        sources: [
          {
            name: "문서",
            excerpt: "<script>시험</script>",
            status: "previous",
            chunk: { text: "실제 본문", page: 2, version: null },
          },
          {
            name: "삭제됨",
            excerpt: "과거",
            status: "unavailable",
            chunk: null,
          },
        ],
      },
    })
  );
  for (const label of [
    "답할 때 참고한 내용",
    "근거 문단",
    "이전 버전",
    "원본 확인 불가",
    "&lt;script&gt;",
  ])
    assert.ok(html.includes(label), label);
  assert.equal(html.includes("<script>"), false);
  assert.doesNotMatch(html, /버전 확인 불가|등록 시각 확인 불가|페이지 확인 불가/);
});

test("긴 내부 번호 대신 쪽과 목록 순서를 표시하고 없는 정보는 숨김", () => {
  const ui = load("./ui.jsx");
  const view = load("./sections/Chunks.jsx", {
    "../ui": ui,
    "@/models/chunkViewer": { default: {} },
    "../chunkViewerController": { createChunkViewerController },
  });
  const html = renderToStaticMarkup(React.createElement(view.ChunksView, {
    controller: {}, workspace: { name: "시험" }, mode: "documents",
    setMode() {}, keyword: "", setKeyword() {},
    state: {
      loading: {}, errors: {}, selectedDocument: "doc", chunkHistory: [],
      chunkOffset: 0, documentOffset: 0,
      documents: { ...empty, items: [{ documentId: "doc", name: "합성 지침" }] },
      chunks: { ...empty, document: {}, items: [
        { id: "internal-long-uuid-12345", text: "첫 문단", page: 31 },
        { id: "internal-long-uuid-67890", text: "둘째 문단", page: null },
      ] },
    },
  }));
  assert.match(html, /31쪽 1번째/);
  assert.match(html, /근거 문단 2번째/);
  assert.match(html, /지침별로 보기/);
  assert.match(html, /질문별로 보기/);
  assert.doesNotMatch(html, /internal-long-uuid|확인 불가|Invalid Date/);
});

test("여러 미확인 출처의 공통 주의는 한 번만 표시함", () => {
  const ui = load("./ui.jsx");
  const view = load("./sections/Chunks.jsx", {
    "../ui": ui, "@/models/chunkViewer": { default: {} },
    "../chunkViewerController": { createChunkViewerController },
  });
  const html = renderToStaticMarkup(React.createElement(view.ChatEvidence, {
    detail: { question: "시험", sources: [1, 2, 3].map(n => ({
      name: `지침 ${n}`, status: "unavailable", excerpt: `근거 ${n}`,
    })) },
  }));
  assert.equal((html.match(/일부 원본의 현재 상태는 확인할 수 없습니다/g) || []).length, 1);
  assert.doesNotMatch(html, /삭제 여부나 이전 버전 여부를/);
  assert.match(html, /근거 3/);
});
test("API는 인증·작업 공간·검색조건을 GET으로 보내고 실패를 드러냄", async () => {
  const deps = {
    "@/utils/constants": { API_BASE: "/api" },
    "@/utils/request": {
      baseHeaders: () => ({ Authorization: "Bearer synthetic" }),
    },
  };
  const calls = [];
  const api = load("../../models/chunkViewer.js", deps, {
    fetch: async (url, options) => {
      calls.push({ url, options });
      return {
        ok: true,
        json: async () => (url.includes("/7?") ? { sources: [] } : empty),
      };
    },
  }).default;
  await api.documents(1, 50);
  await api.chunks(1, { documentId: "doc/a", q: "바늘", offset: 100 });
  await api.chats(1, 0);
  await api.chat(1, 7);
  assert.equal(
    calls[0].url,
    "/api/schat-admin/chunk-documents?workspaceId=1&offset=50"
  );
  assert.equal(
    calls[1].url,
    "/api/schat-admin/chunks?workspaceId=1&documentId=doc%2Fa&q=%EB%B0%94%EB%8A%98&offset=100"
  );
  assert.equal(calls[3].url, "/api/schat-admin/chunk-chats/7?workspaceId=1");
  for (const call of calls) {
    assert.equal(call.options.method, "GET");
    assert.equal(call.options.cache, "no-store");
    assert.equal(call.options.headers.Authorization, "Bearer synthetic");
  }
  const rejected = load("../../models/chunkViewer.js", deps, {
    fetch: async () => ({
      ok: false,
      json: async () => ({ error: "권한 없음" }),
    }),
  }).default;
  await assert.rejects(rejected.documents(1), /권한 없음/);
  const malformed = load("../../models/chunkViewer.js", deps, {
    fetch: async () => ({ ok: true, json: async () => ({}) }),
  }).default;
  await assert.rejects(malformed.chats(1));
});
test("문서 화면의 선택·검색·다음 목록 버튼이 조회 처리에 연결됨", async () => {
  const calls = [];
  const controller = make({
    documents: async () => docs,
    chats: async () => empty,
    chunks: async (_, query) => {
      calls.push(query);
      return {
        ...empty,
        document: {},
        items: [],
        hasMore: true,
        nextOffset: 50,
      };
    },
  });
  await controller.start();
  const ui = load("./ui.jsx");
  const view = load("./sections/Chunks.jsx", {
    "../ui": ui,
    "@/models/chunkViewer": { default: {} },
    "../chunkViewerController": { createChunkViewerController },
  });
  const tree = () =>
    view.ChunksView({
      controller,
      state: controller.getSnapshot(),
      workspace: { name: "시험" },
      mode: "documents",
      setMode() {},
      keyword: "바늘",
      setKeyword() {},
    });
  function find(element, predicate) {
    if (!React.isValidElement(element)) return null;
    if (predicate(element)) return element;
    for (const child of React.Children.toArray(element.props.children)) {
      const found = find(child, predicate);
      if (found) return found;
    }
    return null;
  }
  await find(tree(), (el) => el.type === "form").props.onSubmit({
    preventDefault() {},
  });
  assert.equal(calls.at(-1).q, "바늘");
  const paging = find(
    tree(),
    (el) => el.type.name === "Paging" && el.props.hasNext
  );
  await paging.props.next();
  assert.equal(calls.at(-1).offset, 50);
  await find(tree(), (el) => el.type === "select").props.onChange({
    target: { value: "doc-b" },
  });
  assert.equal(calls.at(-1).documentId, "doc-b");
});
