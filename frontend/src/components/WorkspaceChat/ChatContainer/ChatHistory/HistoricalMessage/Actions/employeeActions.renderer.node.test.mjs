import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { existsSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const frontendRoot = fileURLToPath(
  new URL("../../../../../../..", import.meta.url)
);
const fixtureDir = await mkdtemp(path.join(tmpdir(), "schat-answer-actions-"));
const outfile = path.join(fixtureDir, "render.cjs");
const reactInject = path.join(fixtureDir, "react-inject.js");
await writeFile(reactInject, 'import React from "react"; export { React };');
await build({
  stdin: {
    resolveDir: frontendRoot,
    loader: "jsx",
    contents: `
  import React from "react";
  import { renderToStaticMarkup } from "react-dom/server";
  import { AuthContext } from "./src/AuthContext.jsx";
  import Actions from "./src/components/WorkspaceChat/ChatContainer/ChatHistory/HistoricalMessage/Actions/index.jsx";
  import { I18nextProvider } from "react-i18next";
  import i18n from "i18next";
  i18n.init({ lng: "ko", resources: { ko: { translation: {} } } });
  export function render(user, role = "assistant") {
    return renderToStaticMarkup(<I18nextProvider i18n={i18n}><AuthContext.Provider value={{ store: { user } }}>
      <Actions message="시험 답변" chatId={11} slug="space" isLastMessage role={role} regenerateMessage={() => {}} forkThread={() => {}} />
    </AuthContext.Provider></I18nextProvider>);
  }
`,
  },
  outfile,
  bundle: true,
  platform: "node",
  format: "cjs",
  jsx: "automatic",
  inject: [reactInject],
  define: { "import.meta.env": "{}" },
  nodePaths: [path.join(frontendRoot, "node_modules")],
  loader: { ".svg": "text", ".png": "dataurl", ".css": "empty" },
  plugins: [
    {
      name: "alias",
      setup(api) {
        api.onResolve({ filter: /^@\// }, ({ path: request }) => {
          const base = path.join(frontendRoot, "src", request.slice(2));
          return {
            path:
              [
                base,
                base + ".js",
                base + ".jsx",
                path.join(base, "index.js"),
                path.join(base, "index.jsx"),
              ].find(
                (candidate) =>
                  existsSync(candidate) && statSync(candidate).isFile()
              ) ?? base,
          };
        });
      },
    },
  ],
});
globalThis.localStorage = { getItem: () => null };
const fixture = await import(pathToFileURL(outfile));
function buttons(html) {
  return [...html.matchAll(/data-tooltip-id="([^"]+)"/g)].map(
    (match) => match[1]
  );
}
for (const role of ["default", "manager"])
  test(`${role} 답변 작업은 복사/다시답변/좋아요 순서로 렌더`, () => {
    assert.deepEqual(buttons(fixture.render({ role })), [
      "copy-assistant-text",
      "regenerate-assistant-text",
      "feedback-button",
    ]);
  });
test("관리자와 단독 소유자의 답변 수정과 추가 작업 유지", () => {
  for (const user of [{ role: "admin" }, null]) {
    assert.deepEqual(buttons(fixture.render(user)), [
      "copy-assistant-text",
      "edit-input-text",
      "regenerate-assistant-text",
      "feedback-button",
      "action-menu",
    ]);
  }
});
test("직원 질문 편집 버튼 유지", () => {
  assert.ok(
    buttons(fixture.render({ role: "default" }, "user")).includes(
      "edit-input-text"
    )
  );
});
