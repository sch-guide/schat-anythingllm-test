// 답변 근거 보기: 저장된 답변을 직원 채팅 화면과 같은 모양으로 재현.
// 실제 채팅 답변 컴포넌트(PromptReply)를 묶어 정적 HTML로 확인한다.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

// 관리자 화면 모델이 불러올 때 브라우저 저장소를 읽으므로 빈 대역을 둔다.
globalThis.localStorage ??= {
  getItem: () => null,
  setItem() {},
  removeItem() {},
};

const frontendRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../.."
);

async function render(component, props) {
  const dir = await mkdtemp(path.join(tmpdir(), "schat-chat-replay-"));
  const outfile = path.join(dir, "fixture.cjs");
  const inject = path.join(dir, "react-inject.js");
  await writeFile(inject, 'import React from "react"; export { React };', "utf8");
  const entry = `
    import React from "react";
    import { renderToStaticMarkup } from "react-dom/server";
    import { I18nextProvider } from "react-i18next";
    import i18n from "i18next";
    import ChatReplay from "./src/pages/SchatAdmin/sections/ChatReplay.jsx";
    import { ChatDetail } from "./src/pages/SchatAdmin/sections/Chunks.jsx";
    i18n.init({ lng: "ko", resources: { ko: { translation: {} } } });
    const components = { ChatReplay, ChatDetail };
    export function renderFixture() {
      return renderToStaticMarkup(
        React.createElement(I18nextProvider, { i18n },
          React.createElement(components[${JSON.stringify(component)}], ${JSON.stringify(props)})
        )
      );
    }
  `;
  await build({
    stdin: { contents: entry, resolveDir: frontendRoot, loader: "jsx" },
    outfile,
    bundle: true,
    platform: "node",
    format: "cjs",
    jsx: "automatic",
    define: { "import.meta.env.VITE_API_BASE": '"/api"' },
    inject: [inject],
    nodePaths: [path.join(frontendRoot, "node_modules")],
    // 화면 모양 확인용이라 KaTeX 글꼴·스타일 파일은 비워서 묶는다.
    loader: { ".png": "dataurl", ".svg": "text", ".css": "empty", ".woff": "empty", ".woff2": "empty", ".ttf": "empty" },
    external: ["pdfjs-dist", "pdfjs-dist/*"],
    logLevel: "silent",
    plugins: [
      {
        name: "schat-alias",
        setup(api) {
          // DOM이 없는 Node에서는 DOMPurify가 동작하지 않으므로 script만 지우는 대역을 쓴다.
          api.onResolve({ filter: /^@\/utils\/chat\/purify$/ }, () => ({
            path: "purify-stub",
            namespace: "stub",
          }));
          api.onLoad({ filter: /.*/, namespace: "stub" }, () => ({
            contents:
              "export default { sanitize: (html) => String(html).split('<script').join('&lt;script') };",
            loader: "js",
          }));
          api.onResolve({ filter: /^@\// }, (args) => {
            const base = path.join(frontendRoot, "src", args.path.slice(2));
            const resolved = [
              `${base}.js`,
              `${base}.jsx`,
              path.join(base, "index.js"),
              path.join(base, "index.jsx"),
              base,
            ].find((candidate) => existsSync(candidate));
            return { path: resolved || base };
          });
        },
      },
    ],
  });
  return (await import(pathToFileURL(outfile))).renderFixture();
}

const answerText = [
  "**중심정맥관 드레싱**은 다음과 같습니다.",
  "",
  "| 종류 | 교환 주기 |",
  "|---|---|",
  "| 투명 드레싱 | 7일 |",
  "",
  "- 오염 시 즉시 교환",
  "- <script>alert(1)</script>",
].join("\n");
const detail = {
  id: 30,
  question: "CVC 드레싱 주기 ***",
  answer: {
    available: true,
    text: answerText,
    sources: [
      {
        title: "실무지침서.pdf · p.12",
        documentName: "실무지침서.pdf",
        page: 12,
        excerpt: "투명 드레싱의 경우 7일마다 교환한다.",
      },
    ],
    presentation: null,
    relatedImages: [],
    missing: [],
  },
  sources: [],
};

test("답변 원문 보기는 저장된 답변을 채팅과 같은 Markdown·표·목록으로 보여 줌", async () => {
  const html = await render("ChatReplay", { detail, workspaceSlug: "ws" });
  assert.match(html, /CVC 드레싱 주기 \*\*\*/);
  assert.match(html, /<strong[^>]*>중심정맥관 드레싱<\/strong>/);
  // 저장된 출처도 채팅과 같은 출처 영역으로 보인다.
  assert.match(html, /aria-label="출처 및 근거 원문"/);
  assert.match(html, /<table[\s\S]*투명 드레싱[\s\S]*7일[\s\S]*<\/table>/);
  assert.match(html, /<li>오염 시 즉시 교환<\/li>/);
  assert.doesNotMatch(html, /<script>/);
  // 사용자 질문이 답변보다 먼저 나온다.
  assert.ok(html.indexOf("CVC 드레싱 주기") < html.indexOf("중심정맥관 드레싱"));
});

test("본문이 없는 과거 기록은 지어내지 않고 빠진 항목을 안내함", async () => {
  const html = await render("ChatReplay", {
    detail: { ...detail, answer: { ...detail.answer, available: false, text: "", missing: ["답변 본문"] } },
    workspaceSlug: "ws",
  });
  assert.match(html, /답변 본문이\(가\) 저장되어 있지 않아/);
  assert.match(html, /저장된 답변 본문이 없습니다/);
  assert.doesNotMatch(html, /중심정맥관 드레싱/);
});

test("상세 화면은 답변 원문만 보여 주고 검색 근거 상세는 없음", async () => {
  const html = await render("ChatDetail", { detail, workspaceSlug: "ws" });
  assert.match(html, /직원이 본 답변/);
  assert.match(html, /<strong[^>]*>중심정맥관 드레싱<\/strong>/);
  assert.doesNotMatch(html, /검색 근거 상세 보기|답할 때 참고한 내용|검색 유사도/);
});
