import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, statSync } from "node:fs";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const frontendRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../../.."
);

function resolveAlias(request) {
  const base = path.join(frontendRoot, "src", request.slice(2));
  const candidates = [
    base,
    `${base}.js`,
    `${base}.jsx`,
    path.join(base, "index.js"),
    path.join(base, "index.jsx"),
  ];
  return (
    candidates.find(
      (candidate) => existsSync(candidate) && statSync(candidate).isFile()
    ) || base
  );
}

async function renderWorkspaceDirectory() {
  const outputDirectory = await mkdtemp(
    path.join(tmpdir(), "schat-workspace-directory-")
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
    import WorkspaceDirectory from "./src/components/Modals/ManageWorkspace/Documents/WorkspaceDirectory/index.jsx";
    import { EmbeddingProgressProvider } from "./src/EmbeddingProgressContext.jsx";
    import { I18nextProvider } from "react-i18next";
    import i18n from "i18next";
    global.CustomEvent = class CustomEvent { constructor(type) { this.type = type; } };
    i18n.init({ lng: "ko", resources: { ko: { translation: {} } } });
    const items = Array.from({ length: 10 }, (_, index) => ({
      id: "internal-item-" + (index + 1),
      name: "internal-page-" + (index + 1) + ".json",
      type: "file",
      title: "병원지침.pdf",
      document_id: "internal-source-id",
      url: "file:///internal/병원지침.pdf",
      docSource: "pdf file uploaded by the user.",
      chunkSource: "",
      published: "2026-09-24T00:00:00.000Z",
      page: index + 1,
      section: "",
      pinnedWorkspaces: [],
      watched: false,
    }));
    export function renderFixture() {
      return renderToStaticMarkup(
        React.createElement(I18nextProvider, { i18n },
          React.createElement(EmbeddingProgressProvider, null,
            React.createElement(WorkspaceDirectory, {
              workspace: { id: 1, slug: "test", name: "테스트" },
              files: { name: "documents", type: "folder", items: [{ name: "custom-documents", type: "folder", items }] },
              highlightWorkspace: false,
              loading: false,
              loadingMessage: "",
              setLoadingMessage: () => {},
              setLoading: () => {},
              fetchKeys: async () => {},
              hasChanges: false,
              saveChanges: () => {},
              movedItems: [],
            })
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
    define: { "import.meta.env": "{}" },
    inject: [reactInjectFile],
    nodePaths: [path.join(frontendRoot, "node_modules")],
    loader: { ".png": "dataurl", ".svg": "text" },
    plugins: [{
      name: "schat-alias",
      setup(buildApi) {
        buildApi.onResolve({ filter: /^@\// }, (args) => ({
          path: resolveAlias(args.path),
        }));
      },
    }],
  });

  const module = await import(pathToFileURL(outputFile));
  return module.renderFixture();
}

test("workspace directory renders one original PDF row without internal ids", async () => {
  const html = await renderWorkspaceDirectory();

  assert.equal((html.match(/aria-label="원본 PDF 병원지침\.pdf"/g) || []).length, 1);
  assert.equal((html.match(/>병원지침\.pdf<\/p>/g) || []).length, 1);
  assert.doesNotMatch(html, /internal-source-id|internal-item-|internal-page-|file:\/\/\/internal/);
  assert.doesNotMatch(html, /개 청크|p\.1|섹션 정보 없음/);
});

test("original PDF row keeps selection and narrow-width layout", async () => {
  const html = await renderWorkspaceDirectory();

  assert.match(html, /aria-label="병원지침\.pdf 전체 선택"/);
  assert.match(html, /min-w-0/);
  assert.match(html, /w-full/);
});
