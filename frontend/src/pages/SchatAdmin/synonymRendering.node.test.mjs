import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import * as review from "./synonymReview.js";

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
const { GroupRow } = load("./sections/Synonyms.jsx", {
  "@/models/schatSynonyms": {},
  "@/utils/toast": () => {},
  "@/components/WorkspaceChat/ChatContainer/ChatHistory/Citation/PdfPageViewer":
    () => null,
  "../ui": ui,
  "../synonymReview": review,
});
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

test("active chips are green, off/draft groups are disabled visually and drafts remain available", () => {
  assert.match(render(), /bg-emerald-50[^>]*>관/);
  const draft = render({ status: "needs_review" });
  assert.match(draft, /검토 필요 · 꺼짐/);
  assert.match(draft, /aria-checked="false"/);
  assert.match(draft, /확인한 뒤 사용을 켜면/);
});

test("normal rows offer a category dropdown and disable immediate actions while another draft is open", () => {
  assert.match(render(), /<select[^>]*aria-label="종류"/);
  const locked = render({}, { editingElsewhere: true });
  assert.match(locked, /role="switch"[^>]*disabled=""/);
  assert.match(locked, /<select[^>]*disabled=""/);
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
    "넣기",
    "빼기",
  ])
    assert.ok(html.includes(value), value);
  assert.match(html, /border-dashed border-amber/);
});
