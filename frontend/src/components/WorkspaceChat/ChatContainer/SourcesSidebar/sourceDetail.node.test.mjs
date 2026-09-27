import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const frontendRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../.."
);

async function renderSource(source) {
  const outputDirectory = await mkdtemp(path.join(tmpdir(), "schat-source-detail-"));
  const outputFile = path.join(outputDirectory, "fixture.cjs");
  const reactInjectFile = path.join(outputDirectory, "react-inject.js");
  await writeFile(reactInjectFile, 'import React from "react"; export { React };', "utf8");
  const entry = `
    import React from "react";
    import { renderToStaticMarkup } from "react-dom/server";
    import SourceDetailView from "./src/components/WorkspaceChat/ChatContainer/SourcesSidebar/MobileCitationModal/SourceDetailView/index.jsx";
    import { I18nextProvider } from "react-i18next";
    import i18n from "i18next";
    i18n.init({ lng: "ko", resources: { ko: { translation: {} } } });
    const source = ${JSON.stringify(source)};
    export function renderFixture() {
      return renderToStaticMarkup(
        React.createElement(I18nextProvider, { i18n },
          React.createElement(SourceDetailView, { source, onBack: () => {}, onClose: () => {} })
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
    inject: [reactInjectFile],
    nodePaths: [path.join(frontendRoot, "node_modules")],
    plugins: [{
      name: "schat-alias",
      setup(buildApi) {
        buildApi.onResolve({ filter: /^@\// }, (args) => {
          const base = path.join(frontendRoot, "src", args.path.slice(2));
          return { path: base.endsWith(".svg") ? base : `${base}.js` };
        });
      },
    }],
  });

  const module = await import(pathToFileURL(outputFile));
  return module.renderFixture();
}

test("source excerpt is labeled and scrollable on mobile", async () => {
  const excerpt = "혈액의 수령 즉시 혈액제제 손상 유무를 확인한다.";
  const html = await renderSource({
    title: "지침.pdf · p.117 · 수혈 절차",
    chunks: [{ text: excerpt, score: null }],
  });

  assert.match(html, />근거 원문</);
  assert.match(html, new RegExp(excerpt));
  assert.match(html, /leading-\[1\.6\]/);
  assert.match(html, /max-h-\[50vh\]/);
  assert.match(html, /overflow-y-auto/);
});

test("a source without excerpt keeps the metadata-only detail", async () => {
  const html = await renderSource({
    title: "과거지침.pdf · p.12 · 기존 항목",
    chunks: [{ text: "", score: null }],
  });

  assert.match(html, /과거지침\.pdf/);
  assert.doesNotMatch(html, />근거 원문</);
});
