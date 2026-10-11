import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import * as review from "./synonymReview.js";
import { findSchatAdminSection } from "./menu.js";

const require = createRequire(import.meta.url);
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const { transformSync } = require("esbuild");
function load(file, deps) {
  const module = { exports: {} };
  const { code } = transformSync(
    readFileSync(new URL(file, import.meta.url), "utf8"),
    { loader: "jsx", format: "cjs", jsx: "automatic" }
  );
  vm.runInNewContext(code, {
    module,
    exports: module.exports,
    require: (name) => (name in deps ? deps[name] : require(name)),
  });
  return module.exports;
}
const ui = load("./ui.jsx", {});
const sectionDeps = {
  "@/models/schatSynonyms": {},
  "@/utils/toast": () => {},
  "@/components/WorkspaceChat/ChatContainer/ChatHistory/Citation/PdfPageViewer":
    () => null,
  "../ui": ui,
  "../synonymReview": review,
  "../synonymTable.css": {},
};
const { GroupRow, TermEditor } = load("./sections/Synonyms.jsx", sectionDeps);
function render(change = {}, props = {}) {
  const group = {
    id: 1,
    terms: ["관", "tube"],
    kind: "procedure",
    source: "draft",
    status: "active",
    ...change,
  };
  return renderToStaticMarkup(
    React.createElement(GroupRow, {
      group,
      groups: [group],
      disabled: false,
      editingElsewhere: false,
      ...props,
    })
  );
}

test("표는 회색 사각 단어칩과 상태를 표시하며 기존 사용 중 묶음은 선택할 수 없다", () => {
  assert.match(render(), /<tr/);
  assert.match(render(), /synonym-chip/);
  assert.match(render(), /type="checkbox"[^>]*disabled=""/);
  const draft = render({ status: "needs_review" });
  assert.match(draft, /검토 대기/);
  assert.match(draft, />등록</);
  assert.match(draft, />제외</);
  assert.doesNotMatch(draft, /type="checkbox"[^>]*disabled=""/);
  assert.match(render({ status: "off" }), /사용 안 함/);
});

test("표의 기본 작업은 수정이고 다른 행 편집 중에는 비활성이다", () => {
  assert.match(render(), /<td[^>]*>시술·기구/);
  assert.match(render(), />수정</);
  assert.doesNotMatch(render(), /role="switch"/);
  const locked = render({}, { editingElsewhere: true });
  assert.match(locked, /<button[^>]*disabled=""[^>]*>수정</);
});

test("모바일용 항목 이름과 직접 등록 출처를 유지하고 편집기에서만 사용 상태와 삭제를 제공한다", () => {
  const html = render();
  for (const label of ["선택", "동의어", "분류", "출처", "상태", "작업"])
    assert.ok(html.includes(`data-label="${label}"`), label);
  assert.ok(html.includes("직접 등록"));
  const editor = renderToStaticMarkup(
    React.createElement(TermEditor, {
      terms: ["관", "tube"],
      kind: "procedure",
      status: "off",
      onRemove() {},
      error: "단어를 2개 이상 넣어 주세요.",
    })
  );
  assert.match(editor, /role="switch"[^>]*aria-checked="false"/);
  assert.match(editor, /aria-label="관 삭제"/);
  assert.match(editor, /aria-label="추가할 단어"/);
  assert.match(editor, /role="alert"/);
  assert.match(editor, />묶음 삭제</);
  assert.match(editor, />저장</);
});

test("검토 대기 편집은 저장 후 등록이라고 표시하고 안전한 원문만 열 수 있다", () => {
  const editor = renderToStaticMarkup(
    React.createElement(TermEditor, {
      terms: [],
      kind: "drug",
      status: "needs_review",
      pending: true,
    })
  );
  assert.match(editor, />저장 후 등록</);
  const safe = render({
    source: "auto",
    suggestion: {
      id: 6,
      status: "pending",
      reason: "가짜 근거",
      sources: [
        {
          documentName: "synthetic.pdf",
          pages: [7],
          originalPdfAvailable: true,
          workspaceSlug: "synthetic",
          pdfRef: "a".repeat(43),
        },
      ],
    },
  });
  assert.match(
    safe,
    /<button[^>]*class="synonym-source-link"[^>]*>synthetic.pdf p.7 원문/
  );
  assert.doesNotMatch(safe, /원문을 열 수 없는/);
});

test("suggestion safety badges, document pages and unsupported-source notice survive rendering", () => {
  const html = render({
    pendingAdditions: [
      {
        id: 8,
        terms: ["catheter"],
        status: "pending",
        sourceMissing: true,
        lowConfidence: true,
        test: true,
        reason: "테스트 근거",
        sources: [{ documentName: "missing.pdf", pages: [2], missing: true }],
      },
    ],
  });
  for (const value of [
    "낮은 확신",
    "출처 없음",
    "검증용",
    "missing.pdf p.2",
    "원문을 열 수 없는 문서예요.",
    "제안 catheter 추가",
    "무시",
  ])
    assert.ok(html.includes(value), value);
  assert.match(html, /synonym-proposal-chip/);
  assert.doesNotMatch(html, /제안 정보|추가 후보/);
});

test("loaded synonym screen uses the shared title and exact description once", () => {
  // 서버 렌더링은 비동기 목록 읽기를 실행하지 않으므로 첫 상태에 빈 목록만 공급한다.
  // 나머지 hooks와 실제 화면/하위 구성요소는 React 그대로 렌더링한다.
  let firstState = true;
  const hooks = {
    ...React,
    useState(initial) {
      const value = firstState ? [] : initial;
      firstState = false;
      return React.useState(value);
    },
  };
  const { default: SynonymsSection } = load("./sections/Synonyms.jsx", {
    ...sectionDeps,
    react: hooks,
  });
  const section = findSchatAdminSection("synonyms");
  const html = renderToStaticMarkup(
    React.createElement(
      "main",
      null,
      React.createElement(
        "header",
        null,
        React.createElement("h1", null, section.label),
        React.createElement("p", null, section.description)
      ),
      React.createElement(SynonymsSection)
    )
  );
  assert.equal((html.match(/>동의어 관리</g) || []).length, 1);
  const description =
    "같은 뜻의 말을 묶어 두면, 어떤 말로 물어도 지침을 잘 찾아요.";
  assert.equal(section.description, description);
  assert.equal(html.split(description).length - 1, 1);
  assert.match(html, /<table[^>]*aria-label="동의어 관리 표"/);
  for (const label of [
    "분류 전체",
    "문서 전체",
    "사용 안 함",
    "동의어",
    "출처",
    "작업",
  ])
    assert.ok(html.includes(label), label);
});
