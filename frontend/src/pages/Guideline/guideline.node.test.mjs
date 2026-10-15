// 직원 메뉴 "지침서 원본 보기": 메뉴 연결, 문서 목록, 쪽 이동 계산.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { createRequire } from "node:module";
import { transformSync } from "esbuild";

const require = createRequire(import.meta.url);
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const read = (relative) => readFileSync(new URL(relative, import.meta.url), "utf8");

function load(relative, deps = {}) {
  const module = { exports: {} };
  vm.runInNewContext(
    transformSync(read(relative), { loader: "jsx", format: "cjs", jsx: "automatic" }).code,
    { module, exports: module.exports, require: (name) => (name in deps ? deps[name] : require(name)) }
  );
  return module.exports;
}

test("왼쪽 메뉴 맨 위에 '지침서 원본 보기·지침서 퀴즈·이용 가이드', 그 아래 질문 목록이 PC·휴대폰 모두 있다", () => {
  const sidebar = read("../../components/Sidebar/index.jsx");
  assert.equal((sidebar.match(/<GuidelineLink \/>\s*<QuizLink \/>\s*<GuideLink \/>\s*<ActiveWorkspaces \/>/g) || []).length, 2);
  const link = read("../../components/SchatGuideline/GuidelineLink.jsx");
  assert.match(link, /지침서 원본 보기/);
  assert.match(read("../../main.jsx"), /path: "\/guideline"[\s\S]*PrivateRoute Component=\{GuidelinePage\}/);
  assert.match(read("../../utils/paths.js"), /guideline: \(\) => "\/guideline"/);
});

test("문서 목록은 이름과 쪽 수만 보이고 고른 문서를 표시한다", () => {
  const page = load("./index.jsx", {
    "react-device-detect": { isMobile: false },
    "@phosphor-icons/react": { BookOpenText: () => null, MagnifyingGlass: () => null },
    "@/components/Sidebar": { __esModule: true, default: () => null, SidebarMobileHeader: () => null },
    "@/models/workspace": { default: {} },
    "@/models/guideline": { default: {} },
    "@/components/SchatGuideline/GuidelinePdfViewer": { default: () => null },
    "@/components/SchatGuideline/GuidelineBrowserViewer": { default: () => null },
  });
  const html = renderToStaticMarkup(
    React.createElement(page.GuidelineList, {
      documents: [
        { kind: "library", ref: "ref-a", title: "2026실무지침서 (26.7).pdf", pageCount: 461 },
        { kind: "library", ref: "id-b", title: "인터벤션 처방 모음", pageCount: 12 },
      ],
      selected: "library:id-b",
      onSelect() {},
    })
  );
  assert.match(html, /2026실무지침서 \(26\.7\)<\/span>/);
  assert.match(html, /461쪽/);
  assert.match(html, /aria-pressed="true"[^>]*>[\s\S]*인터벤션 처방 모음/);
  assert.match(html, /12쪽/);
  assert.doesNotMatch(html, /자료실/);
  assert.doesNotMatch(html, /ref-a|\.pdf</);
  const empty = renderToStaticMarkup(React.createElement(page.GuidelineList, { documents: [], onSelect() {} }));
  assert.match(empty, /아직 올라온 지침서가 없습니다/);
});

test("쪽 이동은 1쪽과 마지막 쪽 사이로 맞추고, 내려받기 버튼은 없다", () => {
  const viewer = load("../../components/SchatGuideline/GuidelinePdfViewer.jsx");
  assert.equal(viewer.clampPage("0", 461), 1);
  assert.equal(viewer.clampPage("999", 461), 461);
  assert.equal(viewer.clampPage("120", 461), 120);
  assert.equal(viewer.clampPage("abc", 461), 1);
  const source = read("../../components/SchatGuideline/GuidelinePdfViewer.jsx");
  assert.doesNotMatch(source, /download|내려받기<\/|새 창에서 열기/);
  assert.match(read("../../utils/pdfEvidenceDocument.js"), /disableAutoFetch: true/);
});

test("지침서 원본 보기 화면에는 별도 검색창이 없다(원본 안 찾기는 PDF 보기에서)", () => {
  const page = read("./index.jsx");
  assert.doesNotMatch(page, /role="search"|SearchResults|Guideline\.search/);
  assert.match(page, /돋보기나 Ctrl\+F/);
});

test("관리자 메뉴에 보기 전용 자료실이 있고 챗봇 검색과 분리됨을 안내한다", () => {
  const menu = read("../SchatAdmin/menu.js");
  assert.match(menu, /key: "guideline-library"[\s\S]*label: "지침서 원본 자료"/);
  const admin = read("../SchatAdmin/index.jsx");
  assert.match(admin, /"guideline-library": GuidelineLibrarySection/);
  const section = read("../SchatAdmin/sections/GuidelineLibrary.jsx");
  assert.match(section, /챗봇 답변에는 쓰이지 않아요/);
  assert.match(read("../../models/guideline.js"), /guideline-library\/\$\{encodeURIComponent\(doc\.ref\)\}\/pdf/);
  assert.doesNotMatch(read("../../models/guideline.js"), /original-pdf/);
  assert.match(section, /window\.confirm/);
  assert.match(section, /getTextContent/);
});

test("PC는 브라우저 PDF 보기로 원본을 열어 원본 안 찾기·쪽 미리보기를 쓰고, 휴대폰은 쪽 단위 보기를 쓴다", () => {
  const viewer = load("../../components/SchatGuideline/GuidelineBrowserViewer.jsx");
  assert.equal(viewer.browserViewerUrl("blob:abc", 307), "blob:abc#page=307&view=FitH");
  assert.equal(viewer.browserViewerUrl("blob:abc", "x"), "blob:abc#page=1&view=FitH");
  assert.equal(viewer.browserViewerUrl("", 3), "");
  const page = read("./index.jsx");
  assert.match(page, /isMobile \? \(\s*<GuidelinePdfViewer[\s\S]*\) : \(\s*<GuidelineBrowserViewer/);
  assert.match(read("../../components/SchatGuideline/GuidelineBrowserViewer.jsx"), /Ctrl\+F/);
});
