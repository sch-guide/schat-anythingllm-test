import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../.."
);
const require = createRequire(import.meta.url);
const runtimeRequire = createRequire(process.execPath);

async function fixture(platform = "browser") {
  const result = await build({
    stdin: {
      contents: `import React from 'react';
        import {createRoot} from 'react-dom/client';
        import {renderToStaticMarkup} from 'react-dom/server';
        import {Help, Card, Field} from './src/pages/SchatAdmin/ui.jsx';
        import './src/pages/SchatAdmin/uiHelp.css';
        function Example(){return <main style={{width:'100%'}}>
          <Card title="첫 도움말" description="짧은 소개" help={['첫 설명을 확인해요.', '긴설명'.repeat(100)+'도 줄을 바꿔서 읽어요.']}><p>카드 본문</p></Card>
          <Help label="두 번째 도움말" heading={<h2>둘째 제목</h2>}>{['둘째 설명이에요.', '각각 열고 닫아요.']}</Help>
          <Field label="항목" help="항상 보이는 입력 안내"><input/></Field>
        </main>}
        ${platform === "browser" ? "createRoot(document.getElementById('root')).render(<Example/>);" : "export const html=renderToStaticMarkup(<Example/>);"}`,
      resolveDir: root,
      loader: "jsx",
    },
    bundle: true,
    write: false,
    outdir: "inline-help-test-output",
    platform,
    format: platform === "browser" ? "iife" : "cjs",
    jsx: "automatic",
    define: { "process.env.NODE_ENV": '"production"' },
  });
  return {
    js: result.outputFiles.find((file) => file.path.endsWith(".js")).text,
    css:
      result.outputFiles.find((file) => file.path.endsWith(".css"))?.text || "",
  };
}

test("도움말은 처음 접혀 있고 카드 제목과 유효한 HTML을 만들며 입력 안내는 유지함", async () => {
  const module = { exports: {} };
  new Function("module", "exports", "require", (await fixture("node")).js)(
    module,
    module.exports,
    require
  );
  const html = module.exports.html;
  assert.equal((html.match(/aria-expanded="false"/g) || []).length, 2);
  assert.equal((html.match(/aria-controls=/g) || []).length, 2);
  assert.doesNotMatch(html, /role="tooltip"|position:absolute|\(\?\)/);
  for (const heading of html.matchAll(/<h2\b[^>]*>(.*?)<\/h2>/gs)) {
    assert.doesNotMatch(heading[1], /<div\b|<ul\b/);
  }
  assert.match(html, /항상 보이는 입력 안내/);
  assert.match(html, /카드 본문/);
});

test("실제 클릭·Enter·Space·닫기로 독립적으로 열고 접으며 좁은 화면에서 내용이 흐름을 따라 배치됨", async () => {
  let chromium;
  try {
    ({ chromium } = require("playwright"));
  } catch {
    ({ chromium } = runtimeRequire("playwright"));
  }
  const browser = await chromium.launch({
    channel: process.env.SCHAT_BROWSER_CHANNEL || "msedge",
    headless: true,
  });
  try {
    const page = await browser.newPage({
      viewport: { width: 320, height: 800 },
    });
    page.setDefaultTimeout(3000);
    await page.setContent(
      '<html><body style="margin:0"><div id="root"></div></body></html>'
    );
    const built = await fixture();
    await page.addStyleTag({ content: built.css });
    await page.addScriptTag({ content: built.js });
    const first = page.getByRole("button", { name: "첫 도움말 도움말" });
    const second = page.getByRole("button", { name: "두 번째 도움말" });
    await first.waitFor();
    assert.equal(await first.getAttribute("aria-expanded"), "false");
    assert.equal(await second.getAttribute("aria-expanded"), "false");
    await first.click();
    assert.equal(await first.getAttribute("aria-expanded"), "true");
    assert.equal(await second.getAttribute("aria-expanded"), "false");
    const firstId = await first.getAttribute("aria-controls");
    const panel = page.locator(`[id="${firstId}"]`);
    assert.equal(await panel.locator("li").count(), 2);
    const geometry = await panel.evaluate((el) => {
      const rect = el.getBoundingClientRect();
      const button = document
        .querySelector(`[aria-controls="${el.id}"]`)
        .getBoundingClientRect();
      const styles = getComputedStyle(el);
      return {
        below: rect.top >= button.bottom,
        right: rect.right,
        position: styles.position,
        overflow: document.documentElement.scrollWidth > 320,
      };
    });
    assert.equal(geometry.below, true);
    assert.equal(geometry.position, "static");
    assert.equal(geometry.overflow, false);
    assert.ok(geometry.right <= 320);
    assert.deepEqual(
      await first.evaluate((el) => [el.offsetWidth, el.offsetHeight]),
      [20, 20]
    );
    await second.focus();
    await page.keyboard.press("Enter");
    assert.equal(await second.getAttribute("aria-expanded"), "true");
    await panel.getByRole("button", { name: "닫기" }).click();
    assert.equal(await first.getAttribute("aria-expanded"), "false");
    assert.equal(
      await first.evaluate((el) => el === document.activeElement),
      true
    );
    assert.equal(await second.getAttribute("aria-expanded"), "true");
    await second.focus();
    await page.keyboard.press("Space");
    assert.equal(await second.getAttribute("aria-expanded"), "false");
    await first.click();
    await first.click();
    assert.equal(await first.getAttribute("aria-expanded"), "false");
  } finally {
    await browser.close();
  }
});
