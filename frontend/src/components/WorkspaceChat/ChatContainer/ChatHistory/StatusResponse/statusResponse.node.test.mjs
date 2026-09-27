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

async function renderStatus({ isThinking }) {
  const outputDirectory = await mkdtemp(
    path.join(tmpdir(), "schat-answer-generation-status-")
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
    import StatusResponse from "./src/components/WorkspaceChat/ChatContainer/ChatHistory/StatusResponse/index.jsx";
    import { I18nextProvider } from "react-i18next";
    import i18n from "i18next";
    i18n.init({ lng: "ko", resources: { ko: { translation: {} } } });
    export function renderFixture() {
      return renderToStaticMarkup(
        React.createElement(I18nextProvider, { i18n },
          React.createElement(StatusResponse, {
            messages: [{ uuid: "tool-1", type: "statusResponse", content: "@agent is executing rag-memory tool { private: true }" }],
            isThinking: ${JSON.stringify(isThinking)},
            isLastGroup: true,
          })
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
    banner: {
      js: 'globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };',
    },
    inject: [reactInjectFile],
    nodePaths: [path.join(frontendRoot, "node_modules")],
    loader: {
      ".png": "dataurl",
      ".webm": "dataurl",
      ".css": "empty",
      ".woff": "dataurl",
      ".woff2": "dataurl",
      ".ttf": "dataurl",
    },
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

test("active agent work shows only a simple elapsed answer status", async () => {
  const html = await renderStatus({ isThinking: true });

  assert.match(html, /답변 생성 중 · 1초/);
  assert.doesNotMatch(html, /rag-memory|executing|private/);
});

test("completed agent activity leaves no internal status in the conversation", async () => {
  const html = await renderStatus({ isThinking: false });

  assert.equal(html, "");
});
