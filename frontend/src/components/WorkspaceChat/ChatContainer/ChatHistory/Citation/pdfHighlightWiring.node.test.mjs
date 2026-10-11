import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { build } from "esbuild";

test("actual citation deduplication passes all full chunks to the desktop PDF view", async () => {
  const root = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../../../../.."
  );
  const directory = await mkdtemp(
    path.join(tmpdir(), "schat-highlight-wiring-")
  );
  try {
    const outfile = path.join(directory, "wiring.cjs");
    const inject = path.join(directory, "react.js");
    await writeFile(inject, 'import React from "react"; export { React };');
    await build({
      stdin: {
        contents: `
        import React from "react";
        import { renderToStaticMarkup } from "react-dom/server";
        import Citations, { dedupeCitationSources, SourceEvidenceRow } from "./src/components/WorkspaceChat/ChatContainer/ChatHistory/Citation/index.jsx";
        const sources = [
          { pdfRef: "fixture", page: 1, text: "Full first chunk", excerpt: "First" },
          { pdfRef: "fixture", page: 1, text: "Full second chunk", excerpt: "Second longer" }
        ];
        export const merged = dedupeCitationSources(sources);
        const verifiedSources = [
          {documentName:"used-fixture.pdf",page:1,text:"Observe the test indicator after the procedure.",excerpt:"Observe the test indicator after the procedure.",evidenceQuotes:["Observe the test indicator after the procedure."]},
          {documentName:"unused-fixture.pdf",page:2,text:"Unrelated material",excerpt:"Unrelated material",evidenceQuotes:[]}
        ];
        export const verifiedHtml = renderToStaticMarkup(React.createElement(Citations, {sources:verifiedSources,answer:"Inspect the final status.",workspaceSlug:"fixture"}));

        export const html = renderToStaticMarkup(React.createElement(SourceEvidenceRow, {source: merged[0], index: 0, workspaceSlug: "fixture", initiallyOpen: true}));
      `,
        resolveDir: root,
        loader: "jsx",
      },
      bundle: true,
      platform: "node",
      format: "cjs",
      jsx: "automatic",
      outfile,
      inject: [inject],
      define: { "import.meta.env.VITE_API_BASE": '"/api"' },
      nodePaths: [path.join(root, "node_modules")],
      loader: { ".png": "dataurl", ".svg": "text" },
      external: ["pdfjs-dist", "pdfjs-dist/*"],
      plugins: [
        {
          name: "wiring",
          setup(api) {
            api.onResolve({ filter: /PdfPageViewer$/ }, () => ({
              path: "pdf-view-probe",
              namespace: "probe",
            }));
            api.onLoad({ filter: /.*/, namespace: "probe" }, () => ({
              contents:
                'import React from "react"; export default function Probe({evidenceTexts}) { return React.createElement("pre", null, JSON.stringify(evidenceTexts)); }',
              resolveDir: root,
            }));
            api.onResolve({ filter: /^@\// }, ({ path: input }) => {
              const base = path.join(root, "src", input.slice(2));
              return {
                path:
                  [
                    `${base}.js`,
                    `${base}.jsx`,
                    path.join(base, "index.jsx"),
                    base,
                  ].find(existsSync) || base,
              };
            });
          },
        },
      ],
    });
    const fixture = await import(pathToFileURL(outfile));
    assert.match(fixture.verifiedHtml, /used-fixture.pdf/);
    assert.doesNotMatch(fixture.verifiedHtml, /unused-fixture.pdf/);
    assert.equal(fixture.merged.length, 1);
    assert.deepEqual(fixture.merged[0].highlightTexts, [
      "Full first chunk",
      "Full second chunk",
    ]);
    assert.match(fixture.html, /Full first chunk/);
    assert.match(fixture.html, /Full second chunk/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
