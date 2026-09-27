import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const frontendRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../../.."
);

async function renderCitations(sources) {
  const outputDirectory = await mkdtemp(
    path.join(tmpdir(), "schat-source-evidence-")
  );
  const outputFile = path.join(outputDirectory, "fixture.cjs");
  const reactInjectFile = path.join(outputDirectory, "react-inject.js");
  await writeFile(
    reactInjectFile,
    'import React from "react"; export { React };',
    "utf8"
  );
  const entry = `
    import React from "react";
    import { renderToStaticMarkup } from "react-dom/server";
    import Citations from "./src/components/WorkspaceChat/ChatContainer/ChatHistory/Citation/index.jsx";
    import { ChatSidebarProvider } from "./src/components/WorkspaceChat/ChatContainer/ChatSidebar/index.jsx";
    import { I18nextProvider } from "react-i18next";
    import i18n from "i18next";
    i18n.init({ lng: "ko", resources: { ko: { translation: { chat_window: { sources: "출처" } } } } });
    const sources = ${JSON.stringify(sources)};
    export function renderFixture() {
      return renderToStaticMarkup(
        React.createElement(I18nextProvider, { i18n },
          React.createElement(ChatSidebarProvider, null,
            React.createElement(Citations, { sources })
          )
        )
      );
    }
  `;

  await build({
    stdin: { contents: entry, resolveDir: frontendRoot, loader: "jsx" },
    outfile: outputFile,
    bundle: true,
    platform: "node",
    format: "cjs",
    jsx: "automatic",
    define: { "import.meta.env.VITE_API_BASE": '"/api"' },
    inject: [reactInjectFile],
    nodePaths: [path.join(frontendRoot, "node_modules")],
    loader: { ".png": "dataurl", ".svg": "text" },
    // The mobile PDF canvas (pdf.js) is lazy-loaded in the browser only.
    external: ["pdfjs-dist", "pdfjs-dist/*"],
    plugins: [
      {
        name: "schat-alias",
        setup(buildApi) {
          buildApi.onResolve({ filter: /^@\// }, (args) => {
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

  const module = await import(pathToFileURL(outputFile));
  return module.renderFixture();
}

async function renderEvidenceRow(source, options = {}) {
  const outputDirectory = await mkdtemp(
    path.join(tmpdir(), "schat-source-evidence-row-")
  );
  const outputFile = path.join(outputDirectory, "fixture.cjs");
  const reactInjectFile = path.join(outputDirectory, "react-inject.js");
  await writeFile(
    reactInjectFile,
    'import React from "react"; export { React };',
    "utf8"
  );
  const entry = `
    import React from "react";
    import { renderToStaticMarkup } from "react-dom/server";
    import { SourceEvidenceRow } from "./src/components/WorkspaceChat/ChatContainer/ChatHistory/Citation/index.jsx";
    const source = ${JSON.stringify(source)};
    const options = ${JSON.stringify(options)};
    export function renderFixture() {
      return renderToStaticMarkup(
        React.createElement(SourceEvidenceRow, { source, index: 0, ...options })
      );
    }
  `;

  await build({
    stdin: { contents: entry, resolveDir: frontendRoot, loader: "jsx" },
    outfile: outputFile,
    bundle: true,
    platform: "node",
    format: "cjs",
    jsx: "automatic",
    define: { "import.meta.env.VITE_API_BASE": '"/api"' },
    inject: [reactInjectFile],
    nodePaths: [path.join(frontendRoot, "node_modules")],
    loader: { ".png": "dataurl", ".svg": "text" },
    // The mobile PDF canvas (pdf.js) is lazy-loaded in the browser only.
    external: ["pdfjs-dist", "pdfjs-dist/*"],
    plugins: [
      {
        name: "schat-alias",
        setup(buildApi) {
          buildApi.onResolve({ filter: /^@\// }, (args) => {
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

  const module = await import(pathToFileURL(outputFile));
  return module.renderFixture();
}

test("an opened source renders only its directly linked images below the excerpt", async () => {
  const html = await renderEvidenceRow(
    {
      documentName: "통증지침.pdf",
      page: 100,
      section: "통증 평가",
      excerpt: "NRS는 0점부터 10점까지의 통증 정도를 확인합니다.",
      relatedImages: [
        {
          imageKey: "a".repeat(64),
          documentName: "통증지침.pdf",
          page: 100,
          section: "통증 평가",
          matchType: "image_description",
        },
      ],
    },
    { initiallyOpen: true, workspaceSlug: "hospital-guide" }
  );

  assert.match(html, /근거 원문/);
  assert.match(html, /관련 이미지/);
  assert.match(html, /통증지침\.pdf/);
  assert.match(html, /p\.100/);
});

test("a source with pdfRef opens the protected original page before excerpt fallback", async () => {
  const html = await renderEvidenceRow(
    {
      documentName: "hospital-guide.pdf",
      page: 273,
      section: "patient confirmation",
      excerpt: "fallback excerpt must stay hidden while the PDF is loading",
      pdfRef: "a".repeat(43),
      relatedImages: [{ imageKey: "b".repeat(64) }],
    },
    { initiallyOpen: true, workspaceSlug: "hospital-guide" }
  );

  assert.match(html, /PDF 원본 p\.273/);
  assert.match(html, /원본 PDF 페이지를 불러오는 중/);
  assert.doesNotMatch(html, /fallback excerpt must stay hidden/);
  assert.doesNotMatch(html, /관련 이미지/);
});

test("a source without a direct image keeps the image area hidden", async () => {
  const html = await renderEvidenceRow(
    {
      documentName: "통증지침.pdf",
      excerpt: "통증 평가 근거 원문입니다.",
      relatedImages: [],
    },
    { initiallyOpen: true, workspaceSlug: "hospital-guide" }
  );

  assert.doesNotMatch(html, /관련 이미지/);
});

test("validated sources render an independent collapsed evidence row", async () => {
  const html = await renderCitations([
    {
      title: "2026실무지침서.pdf · p.100 · 통증 평가",
      documentName: "2026실무지침서.pdf",
      page: 100,
      section: "통증 평가",
      excerpt: "NRS 점수와 통증 부위를 확인한다.",
    },
    {
      title: "검사 및 시술.pdf · p.12 · 준비",
      documentName: "검사 및 시술.pdf",
      page: 12,
      section: "준비",
      excerpt: "검사 전 준비사항을 확인한다.",
    },
  ]);

  assert.match(html, /출처 1/);
  assert.match(html, /출처 2/);
  assert.match(html, /2026실무지침서\.pdf/);
  assert.match(html, /p\.100/);
  assert.doesNotMatch(html, /통증 평가| · 준비/);
  assert.equal((html.match(/근거 원문 보기/g) || []).length, 2);
  assert.doesNotMatch(html, /NRS 점수와 통증 부위를 확인한다/);
});

test("the citation list is the only source entry point below an answer", async () => {
  const html = await renderCitations([
    {
      documentName: "실무지침서.pdf",
      page: 273,
      section: "환자 확인",
      excerpt: "환자 정보를 확인한다.",
    },
  ]);

  assert.match(html, />출처 1<\/span> · 실무지침서\.pdf · p\.273/);
  assert.doesNotMatch(html, /환자 확인/);
  assert.doesNotMatch(html, />출처<\/span>/);
  assert.equal((html.match(/근거 원문 보기/g) || []).length, 1);
});

test("opened evidence uses readable responsive padding width line height and paragraph spacing", async () => {
  const html = await renderEvidenceRow(
    {
      documentName: "실무지침서.pdf",
      page: 273,
      section: "환자 확인",
      excerpt: "첫 번째 근거 문단입니다.\n\n두 번째 근거 문단입니다.",
    },
    { initiallyOpen: true }
  );

  assert.match(html, /px-4/);
  assert.match(html, /sm:px-7/);
  assert.match(html, /max-w-\[720px\]/);
  assert.match(html, /leading-\[1\.7\]/);
  assert.match(html, /space-y-3/);
  assert.match(html, /첫 번째 근거 문단입니다/);
  assert.match(html, /두 번째 근거 문단입니다/);
});

test("a past source without excerpt remains metadata-only", async () => {
  const html = await renderCitations([
    {
      title: "과거지침.pdf · p.12 · 기존 항목",
      documentName: "과거지침.pdf",
      page: "12",
      section: "기존 항목",
      text: "이 값은 excerpt가 아니므로 새 인라인 원문에 사용하지 않는다.",
    },
  ]);

  assert.match(html, /과거지침\.pdf/);
  assert.match(html, /p\.12/);
  assert.doesNotMatch(html, /근거 원문 보기/);
  assert.doesNotMatch(html, /이 값은 excerpt가 아니므로/);
});

test("the inline source summary never renders internal-only fields", async () => {
  const html = await renderCitations([
    {
      id: "source_unit_12345",
      title: "안전지침.pdf · p.8 · 확인",
      documentName: "안전지침.pdf",
      page: 8,
      section: "확인",
      excerpt: "환자 정보를 확인한다.",
      chunkSource: "file:///app/server/storage/internal.pdf",
      metadata: { vectorId: "vector-secret", svg: "<svg>secret</svg>" },
    },
  ]);

  assert.doesNotMatch(html, /source_unit_12345/);
  assert.doesNotMatch(html, /\/app\/server\/storage/);
  assert.doesNotMatch(html, /vector-secret|secret&lt;\/svg/);
});

test("a legacy title fallback keeps only the public filename", async () => {
  const html = await renderCitations([
    {
      title: "C:\\private-storage\\legacy-guide.pdf",
      excerpt: "공개 가능한 근거 원문입니다.",
    },
  ]);

  assert.match(html, /legacy-guide\.pdf/);
  assert.doesNotMatch(html, /private-storage/);
});

test("opening one source reveals its excerpt and a long excerpt has more control", async () => {
  const excerpt = `첫 문장입니다. ${"긴 근거 원문입니다. ".repeat(40)}`;
  const html = await renderEvidenceRow(
    {
      documentName: "실무지침서.pdf",
      page: 100,
      section: "통증 평가",
      excerpt,
    },
    { initiallyOpen: true }
  );

  assert.match(html, /근거 원문/);
  assert.match(html, /첫 문장입니다/);
  assert.match(html, /더보기/);
  assert.match(html, /aria-expanded="false"/);
});

test("an expanded long excerpt offers a collapse control", async () => {
  const html = await renderEvidenceRow(
    {
      documentName: "실무지침서.pdf",
      page: 100,
      section: "통증 평가",
      excerpt: "긴 근거 원문입니다. ".repeat(40),
    },
    { initiallyOpen: true, initiallyExpanded: true }
  );

  assert.match(html, /접기/);
  assert.match(html, /aria-expanded="true"/);
  assert.match(html, /max-h-\[50vh\]/);
});

test("same PDF page chunks render as one citation without section text", async () => {
  const html = await renderCitations([
    {
      pdfRef: "a".repeat(43),
      documentName: "2026실무지침서.pdf",
      page: 113,
      section: "혈액의 결핍 구성 성분을 보충",
      excerpt: "짧은 근거",
    },
    {
      pdfRef: "a".repeat(43),
      documentName: "2026실무지침서.pdf",
      page: 113,
      section: "3. 혈액 제제의 종류",
      excerpt: "같은 페이지의 더 충분하고 긴 근거 원문",
    },
  ]);

  assert.equal((html.match(/출처 \d+/g) || []).length, 1);
  assert.match(html, />출처 1<\/span> · 2026실무지침서\.pdf · p\.113/);
  assert.doesNotMatch(html, /혈액의 결핍|혈액 제제의 종류/);
});

test("different pages in one PDF remain separate citations", async () => {
  const html = await renderCitations([
    {
      pdfRef: "a".repeat(43),
      documentName: "2026실무지침서.pdf",
      page: 113,
      excerpt: "p113",
    },
    {
      pdfRef: "a".repeat(43),
      documentName: "2026실무지침서.pdf",
      page: 114,
      excerpt: "p114",
    },
  ]);

  assert.equal((html.match(/출처 \d+/g) || []).length, 2);
});

test("different PDFs on the same page remain separate citations", async () => {
  const html = await renderCitations([
    {
      pdfRef: "a".repeat(43),
      documentName: "첫번째.pdf",
      page: 113,
      excerpt: "첫번째 문서",
    },
    {
      pdfRef: "b".repeat(43),
      documentName: "두번째.pdf",
      page: 113,
      excerpt: "두번째 문서",
    },
  ]);

  assert.equal((html.match(/출처 \d+/g) || []).length, 2);
});
