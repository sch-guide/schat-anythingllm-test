// 실제 표 스타일의 줄바꿈·버튼 크기를 브라우저에서 검사합니다. 외부 요청은 없습니다.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const puppeteer = require(process.env.PUPPETEER_MODULE || 'puppeteer');

(async () => {
  const browser = await puppeteer.launch({
    executablePath: process.env.CHROME_PATH,
    headless: 'new',
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  try {
    const page = await browser.newPage();
    const css = fs.readFileSync(process.argv[2], 'utf8');
    for (const width of [1000, 720, 390]) {
      await page.setViewport({ width, height: 600 });
      await page.setContent(`<style>*{box-sizing:border-box}body{margin:0}button{font:14px sans-serif}${css}</style>
        <table class="synonym-table"><thead><tr><th></th><th>동의어</th><th>분류</th><th>상태</th><th>작업</th></tr></thead>
        <tbody><tr data-synonym-group="1"><td></td><td data-label="동의어">시험 용어</td><td data-label="분류">용어</td><td data-label="상태">검토 대기</td>
        <td data-label="작업"><div class="synonym-actions"><button class="synonym-register">등록</button><button>수정</button><button>제외</button></div></td></tr></tbody></table>`);
      const result = await page.$eval('.synonym-actions', (element) => {
        const buttons = [...element.children].map((button) => {
          const rect = button.getBoundingClientRect();
          return { x: rect.x, y: rect.y, right: rect.right, height: rect.height };
        });
        return { buttons, column: element.parentElement.getBoundingClientRect().width,
          overflow: document.documentElement.scrollWidth > innerWidth };
      });
      assert.equal(result.overflow, false, `${width}px: 화면 가로 넘침`);
      if (width > 700) {
        assert.equal(result.column, 220, `${width}px: 작업 칸 너비`);
        assert.equal(new Set(result.buttons.map((b) => b.y)).size, 1, '세 버튼 한 줄');
        for (const button of result.buttons) assert.equal(button.height, 30, '버튼 높이');
        assert.equal(result.buttons[1].x - result.buttons[0].right, 6, '버튼 간격');
      }
      console.log(`${width}px: 통과`);
    }
  } finally { await browser.close(); }
})().catch((error) => { console.error(error.message); process.exitCode = 1; });
