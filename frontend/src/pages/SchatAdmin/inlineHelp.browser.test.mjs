// 선택형 브라우저 검증: frontend에서 npm run test:admin-help:browser
// 요구 환경: Playwright 1.57.0 + 설치된 Chromium(또는 명시한 브라우저 채널).
// 준비: npm install --no-save --package-lock=false playwright@1.57.0
//       npx playwright install chromium
// 별도 설치 경로는 SCHAT_PLAYWRIGHT_MODULE, 설치된 채널은 SCHAT_BROWSER_CHANNEL로 지정해요.
// 일반 *.node.test.mjs 실행에는 포함되지 않으며 환경이 없으면 실패해요.
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { helpFixture } from "./inlineHelp.testFixture.mjs";

const require = createRequire(import.meta.url);

test("실제 클릭·Enter·Space·닫기로 독립적으로 열고 접으며 좁은 화면에서 내용이 흐름을 따라 배치됨", async () => {
  let chromium;
  try {
    ({ chromium } = require(
      process.env.SCHAT_PLAYWRIGHT_MODULE || "playwright"
    ));
  } catch (cause) {
    throw new Error(
      "브라우저 검증에는 Playwright가 필요해요. frontend에서 npm install --no-save --package-lock=false playwright@1.57.0을 실행하거나 SCHAT_PLAYWRIGHT_MODULE에 별도 설치 경로를 지정해 주세요.",
      { cause }
    );
  }
  let browser;
  try {
    browser = await chromium.launch({
      ...(process.env.SCHAT_BROWSER_CHANNEL
        ? { channel: process.env.SCHAT_BROWSER_CHANNEL }
        : {}),
      headless: true,
    });
  } catch (cause) {
    throw new Error(
      "브라우저 실행에 실패했어요. npx playwright install chromium을 실행하거나 설치된 브라우저를 SCHAT_BROWSER_CHANNEL로 지정해 주세요.",
      { cause }
    );
  }
  try {
    const page = await browser.newPage({
      viewport: { width: 320, height: 800 },
    });
    page.setDefaultTimeout(3000);
    await page.setContent(
      '<html><body style="margin:0"><div id="root"></div></body></html>'
    );
    const built = await helpFixture();
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
