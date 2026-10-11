import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { helpFixture } from "./inlineHelp.testFixture.mjs";

const require = createRequire(import.meta.url);

test("도움말은 처음 접혀 있고 카드 제목과 유효한 HTML을 만들며 입력 안내는 유지함", async () => {
  const module = { exports: {} };
  new Function("module", "exports", "require", (await helpFixture("node")).js)(
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
  const panels = [
    ...html.matchAll(/<div[^>]*class="schat-help__panel"[^>]*>(.*?)<\/div>/gs),
  ];
  assert.equal(panels.length, 2);
  for (const [, content] of panels) {
    assert.match(content, /^<ul>/);
    assert.doesNotMatch(content, /<button\b|닫기/);
  }
});
