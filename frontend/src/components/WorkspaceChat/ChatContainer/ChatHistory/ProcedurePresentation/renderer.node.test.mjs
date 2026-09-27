import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const frontendRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../../.."
);

async function renderProcedureFixture() {
  const outputDirectory = await mkdtemp(
    path.join(tmpdir(), "schat-procedure-renderer-")
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
    import ProcedurePresentation from "./src/components/WorkspaceChat/ChatContainer/ChatHistory/ProcedurePresentation/index.jsx";
    import { ChatSidebarProvider } from "./src/components/WorkspaceChat/ChatContainer/ChatSidebar/index.jsx";

    const presentation = {
      kind: "procedure",
      summary: "절차는 두 단계로 진행합니다.",
      sections: [
        {
          title: "첫 단계",
          items: [
            { text: "첫 행동입니다.", sourceIndexes: [1] },
            { text: "두 번째 행동입니다.", sourceIndexes: [1, 2] },
          ],
        },
        {
          title: "두 번째 단계",
          items: [{ text: "마지막 행동입니다.", sourceIndexes: [2] }],
        },
      ],
    };
    const sources = [
      { title: "지침 · p.1" },
      { title: "지침 · p.2" },
    ];

    export function renderFixture() {
      return renderToStaticMarkup(
        React.createElement(
          ChatSidebarProvider,
          null,
          React.createElement(ProcedurePresentation, { presentation, sources })
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
    plugins: [
      {
        name: "schat-alias",
        setup(buildApi) {
          buildApi.onResolve({ filter: /^@\// }, (args) => ({
            path: `${path.join(frontendRoot, "src", args.path.slice(2))}.js`,
          }));
        },
      },
    ],
  });

  const module = await import(pathToFileURL(outputFile));
  return {
    html: module.renderFixture(),
    bundle: await readFile(outputFile, "utf8"),
  };
}

test("procedure renderer shows one explicit visual bullet for every item", async () => {
  const { html } = await renderProcedureFixture();

  assert.equal((html.match(/<ul\b/g) || []).length, 2);
  assert.equal((html.match(/<li\b/g) || []).length, 3);
  assert.equal(
    (html.match(/aria-hidden="true"[^>]*>•<\/span>/g) || []).length,
    3
  );
});

test("procedure renderer applies the approved document layout", async () => {
  const { html } = await renderProcedureFixture();

  assert.match(html, /max-w-\[780px\]/);
  assert.match(html, /w-full/);
  assert.match(html, /leading-\[1\.7\]/);
  assert.match(html, /font-medium/);
  assert.match(html, /font-semibold/);
  assert.match(html, /gap-y-2/);
  assert.equal((html.match(/mt-8 first:mt-0/g) || []).length, 2);
});

test("procedure renderer shows each source once after the final sentence", async () => {
  const { html } = await renderProcedureFixture();

  assert.equal((html.match(/aria-label="출처 1:/g) || []).length, 1);
  assert.equal((html.match(/aria-label="출처 2:/g) || []).length, 1);
  assert.ok(html.indexOf('aria-label="출처 1:') > html.lastIndexOf("</li>"));
  assert.ok(html.indexOf('aria-label="출처 2:') > html.lastIndexOf("</li>"));
});
