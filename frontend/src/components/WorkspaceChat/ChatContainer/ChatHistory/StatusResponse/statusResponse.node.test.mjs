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

async function renderStatus({ isThinking, phase = "search", stopped = null }) {
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
    import StatusResponse, { StoppedNotice } from "./src/components/WorkspaceChat/ChatContainer/ChatHistory/StatusResponse/index.jsx";
    import { I18nextProvider } from "react-i18next";
    import i18n from "i18next";
    i18n.init({ lng: "ko", resources: { ko: { translation: {} } } });
    export function renderFixture() {
      const stopped = ${JSON.stringify(stopped)};
      return renderToStaticMarkup(
        React.createElement(I18nextProvider, { i18n },
          stopped
            ? React.createElement(StoppedNotice, { reason: stopped, onRetry: () => {} })
            : React.createElement(StatusResponse, {
                messages: [{ uuid: "tool-1", type: "statusResponse", content: "@agent is executing rag-memory tool { private: true }" }],
                isThinking: ${JSON.stringify(isThinking)},
                phase: ${JSON.stringify(phase)},
                onStop: () => {},
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
      js: "globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };",
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

test("active agent work shows the friendly step and a spinning indicator, without seconds", async () => {
  const html = await renderStatus({ isThinking: true });

  assert.match(html, /문서를 찾는 중…/);
  assert.doesNotMatch(html, /[0-9]+초/);
  assert.doesNotMatch(html, /멈추기|<button/);
  assert.match(html, /animate-spin/);
  assert.match(html, /aria-hidden="true"/);
  assert.doesNotMatch(html, /rag-memory|executing|private/);
  // The slow notice appears only after 20 seconds.
  assert.doesNotMatch(html, /오래 걸리고 있습니다/);
});

test("each step has its own words", async () => {
  assert.match(
    await renderStatus({ isThinking: true, phase: "research" }),
    /문서를 한 번 더 찾는 중…/
  );
  assert.match(
    await renderStatus({ isThinking: true, phase: "answer" }),
    /답변을 작성하는 중…/
  );
});

test("a stopped answer offers 다시 시도 and never says the guideline is missing", async () => {
  const user = await renderStatus({ isThinking: false, stopped: "user" });
  const timeout = await renderStatus({ isThinking: false, stopped: "timeout" });
  assert.match(user, /답변을 멈췄습니다/);
  assert.match(
    timeout,
    /응답이 늦어지고 있습니다\. 잠시 후 다시 시도해 주세요\./
  );
  for (const html of [user, timeout]) {
    assert.match(html, />다시 시도</);
    assert.doesNotMatch(html, /확인되지 않습니다/);
  }
});

test("completed agent activity leaves no internal status in the conversation", async () => {
  const html = await renderStatus({ isThinking: false });

  assert.equal(html, "");
});
