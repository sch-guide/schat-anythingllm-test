// 선택형 브라우저 검증. SCHAT_PLAYWRIGHT_MODULE과 SCHAT_BROWSER_CHANNEL은
// inlineHelp.browser.test.mjs와 같은 방식으로 지정할 수 있어요.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const css = readFileSync(
  new URL("./synonymTable.css", import.meta.url),
  "utf8"
);

test("동의어 새 묶음 버튼은 PC 전역 알림·계정 영역과 겹치지 않고 모바일에서는 줄바꿈된다", async () => {
  const { chromium } = require(
    process.env.SCHAT_PLAYWRIGHT_MODULE || "playwright"
  );
  const browser = await chromium.launch({
    headless: true,
    ...(process.env.SCHAT_BROWSER_CHANNEL
      ? { channel: process.env.SCHAT_BROWSER_CHANNEL }
      : {}),
  });
  try {
    const page = await browser.newPage();
    for (const width of [1440, 1024, 768, 390]) {
      const desktop = width >= 768;
      await page.setViewportSize({ width, height: 800 });
      // 실제 화면의 콘텐츠 여백과 UserButton의 절대 위치·35px 두 버튼·8px 간격을 재현한다.
      // 대상은 실제 synonymTable.css이며 네트워크나 실제 계정 자료는 사용하지 않는다.
      await page.setContent(`<!doctype html><html lang="ko"><style>
        * { box-sizing: border-box; }
        body { margin: 0; font-family: sans-serif; }
        main { position: absolute; top: ${desktop ? 41 : 160}px; left: ${desktop ? 314 : 20}px; right: ${desktop ? 66 : 20}px; }
        .title { width: 340px; max-width: 100%; }
        h1, p { margin: 0; } h1 { font-size: 18px; line-height: 24px; } p { font-size: 12px; line-height: 20px; }
        .synonym-header { border-bottom: 2px solid #ddd; padding-bottom: 20px; }
        .synonym-top-actions button { padding: 8px 14px; white-space: nowrap; font-size: 14px; }
        .schat-user-menu { position: absolute; top: ${desktop ? 36 : 12}px; right: ${desktop ? 40 : 16}px; display: flex; gap: 8px; }
        .schat-user-menu button { width: 35px; height: 35px; padding: 0; }
      </style><body>
        <main><header class="synonym-header">
          <div class="title"><p>SCHAT 관리자 설정</p><h1>동의어 관리</h1><p>같은 뜻의 말을 묶어 두면, 어떤 말로 물어도 지침을 잘 찾아요.</p></div>
          <div class="synonym-top-actions"><button>+ 새 묶음 추가</button></div>
        </header></main>
        <div class="schat-user-menu"><button aria-label="알림">알림</button><button aria-label="사용자 메뉴">계정</button></div>
      </body></html>`);
      await page.addStyleTag({ content: css });
      const geometry = await page.evaluate(() => {
        const rect = (selector) => {
          const { left, right, top, bottom } = document
            .querySelector(selector)
            .getBoundingClientRect();
          return { left, right, top, bottom };
        };
        return {
          action: rect(".synonym-top-actions button"),
          title: rect(".title"),
          controls: rect(".schat-user-menu"),
          overflow: document.documentElement.scrollWidth > window.innerWidth,
        };
      });
      const { action, controls, title } = geometry;
      const overlaps =
        action.left < controls.right &&
        action.right > controls.left &&
        action.top < controls.bottom &&
        action.bottom > controls.top;
      assert.equal(
        overlaps,
        false,
        `${width}px에서 새 묶음과 전역 버튼이 겹침: ${JSON.stringify(geometry)}`
      );
      assert.equal(geometry.overflow, false, `${width}px에서 가로 넘침`);
      if (width === 1440) {
        assert.ok(
          action.right + 12 <= controls.left,
          "PC에서 공통 버튼 앞에 여유 공간이 있어야 한다"
        );
        assert.ok(
          action.left >= title.right,
          "넓은 PC에서 제목 오른쪽 배치를 유지해야 한다"
        );
      }
      if (!desktop)
        assert.ok(
          action.top >= title.bottom,
          "모바일에서 버튼이 제목 아래로 줄바꿈되어야 한다"
        );
    }
  } finally {
    await browser.close();
  }
});
