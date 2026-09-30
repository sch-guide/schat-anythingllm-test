// The administrator "보기" and "수정" screens and the employee screen render
// the same ChecklistTree. Editing only swaps each text for a field in place,
// so the order, hierarchy, checkboxes and note lines must be identical.
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
  const candidates = [base, `${base}.js`, `${base}.jsx`];
  return (
    candidates.find(
      (candidate) => existsSync(candidate) && statSync(candidate).isFile()
    ) || base
  );
}

let rendererPromise;
async function renderer() {
  rendererPromise ||= (async () => {
    const outputDirectory = await mkdtemp(
      path.join(tmpdir(), "schat-checklist-edit-")
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
      import ChecklistTree from "./src/components/WorkspaceChat/ChatContainer/ChatHistory/Checklist/ChecklistTree.jsx";
      const noop = () => {};
      const edit = { updateSection: noop, updateItem: noop, moveItem: noop, removeItem: noop, addItem: noop };
      export function render(checklist, editing) {
        return renderToStaticMarkup(
          React.createElement(ChecklistTree, {
            checklist,
            checkedItems: {},
            onCheckedChange: noop,
            expandedSections: {},
            onToggleSection: noop,
            edit: editing ? edit : null,
          })
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
      plugins: [
        {
          name: "schat-alias",
          setup(buildApi) {
            buildApi.onResolve({ filter: /^@\// }, (args) => ({
              path: resolveAlias(args.path),
            }));
          },
        },
      ],
    });
    return import(pathToFileURL(outputFile));
  })();
  return rendererPromise;
}

// Placeholder wording shaped like a real handbook page.
const checklist = {
  id: "cl-1",
  title: "가상 기관지 내시경",
  aliases: ["가상 내시경"],
  sections: [
    {
      id: "s-before",
      title: "검사 전",
      items: [
        {
          id: "i-purpose",
          type: "informational",
          label: "검사목적",
          details: ["가상 목적 설명"],
        },
        {
          id: "i-consent",
          type: "checkable",
          label: "동의서",
          details: [
            "① 기관지 내시경 검사 동의서",
            "② 진정동의서",
            "③ 진정 비급여 동의서",
          ],
        },
        {
          id: "i-fasting",
          type: "checkable",
          label: "금식여부",
          details: ["AM : MN NPO", "PM : 아침 먹고 NPO"],
          detailCheckable: [false, false],
        },
        {
          id: "i-iv",
          type: "checkable",
          label: "IV line",
          details: [
            "18G",
            ": 혈압 저하, 응급상황 사용 할 수 있게",
            "아무것도 mix 안된 fluid 연결",
          ],
          detailCheckable: [true, false, true],
        },
      ],
    },
    {
      id: "s-after",
      title: "검사 후",
      items: [
        {
          id: "i-watch",
          type: "checkable",
          label: "관찰사항",
          details: ["가상 관찰", "※ 가상 참고"],
        },
      ],
    },
  ],
};

const decode = (text) =>
  text
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");

/** Structure tokens in document order (checkboxes, note lines, info rows). */
function skeleton(html) {
  const tokens = [];
  for (const [tag, content] of html.matchAll(
    /<[^>]*data-checklist-[^>]*>([^<]*)/g
  )) {
    const kinds = [...tag.matchAll(/data-checklist-([a-z]+)=""/g)].map(
      ([, kind]) => kind
    );
    for (const kind of ["parent", "child", "info", "note"])
      if (kinds.includes(kind)) tokens.push(kind);
    if (kinds.includes("text")) tokens.push(`text:${decode(content).trim()}`);
  }
  return tokens;
}

function sectionTitles(html, editing) {
  const pattern = editing
    ? /aria-label="섹션 제목"[^>]*value="([^"]*)"/g
    : /<button[^>]*aria-expanded="true"[^>]*><span>([^<]*)<\/span>/g;
  return [...html.matchAll(pattern)].map(([, title]) => decode(title));
}

test("보기와 수정 화면은 항목 순서·계층·체크박스·설명 줄 위치가 같다", async () => {
  const { render } = await renderer();
  const view = render(checklist, false);
  const edit = render(checklist, true);

  assert.deepEqual(skeleton(edit), skeleton(view));
  assert.deepEqual(sectionTitles(edit, true), sectionTitles(view, false));
  assert.deepEqual(sectionTitles(view, false), ["검사 전", "검사 후"]);

  // the expected shape of the example: parent + ①②③ children,
  // 금식여부 lines as notes, IV line 18G / note / child
  const tokens = skeleton(view);
  const from = (label) => tokens.indexOf(`text:${label}`);
  assert.deepEqual(tokens.slice(from("동의서") - 1, from("동의서") + 7), [
    "parent",
    "text:동의서",
    "child",
    "text:① 기관지 내시경 검사 동의서",
    "child",
    "text:② 진정동의서",
    "child",
    "text:③ 진정 비급여 동의서",
  ]);
  assert.deepEqual(tokens.slice(from("금식여부") - 1, from("금식여부") + 5), [
    "parent",
    "text:금식여부",
    "note",
    "text:AM : MN NPO",
    "note",
    "text:PM : 아침 먹고 NPO",
  ]);
  assert.deepEqual(tokens.slice(from("IV line") - 1, from("IV line") + 7), [
    "parent",
    "text:IV line",
    "child",
    "text:18G",
    "note",
    "text:: 혈압 저하, 응급상황 사용 할 수 있게",
    "child",
    "text:아무것도 mix 안된 fluid 연결",
  ]);
});

test("같은 줄은 보기와 수정에서 같은 들여쓰기 칸 안에 있다", async () => {
  const { render } = await renderer();
  for (const html of [render(checklist, false), render(checklist, true)]) {
    // information rows and every item's lines use the same pl-8 column
    assert.equal((html.match(/data-checklist-info=""/g) || []).length, 1);
    assert.match(html, /data-checklist-info="" class="min-w-0 pl-8"/);
    assert.equal(
      (html.match(/class="flex flex-col gap-1 pl-8"/g) || []).length,
      4
    );
    // note lines keep the extra pl-7 indent under their item
    assert.equal(
      (
        html.match(
          /data-checklist-note=""[^>]*pl-7|pl-7[^>]*data-checklist-note=""/g
        ) || []
      ).length,
      4
    );
  }
});

test("수정 화면은 한 줄 입력 목록이 아니라 제자리 입력칸과 도구를 가진다", async () => {
  const { render } = await renderer();
  const edit = render(checklist, true);
  const view = render(checklist, false);
  // 5 item titles + 11 lines, each edited where it is shown
  assert.equal((edit.match(/<textarea/g) || []).length, 16);
  assert.match(edit, /항목 추가/);
  assert.match(edit, /줄 추가/);
  assert.match(edit, /aria-label="항목 삭제"/);
  assert.match(edit, /체크 줄/);
  assert.match(edit, /설명 줄/);
  // checkboxes are shown where employees see them but cannot be ticked
  assert.match(
    edit,
    /data-checklist-parent=""[^>]*disabled|disabled[^>]*data-checklist-parent=""/
  );
  assert.doesNotMatch(view, /<textarea|항목 추가|줄 추가/);
});
