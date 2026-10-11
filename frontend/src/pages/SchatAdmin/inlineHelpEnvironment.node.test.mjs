import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// 선택형 의존성이 없는 일반 설치를 재현해요. 실제 화면 코드는 바꾸지 않아요.
const withoutPlaywright = `import Module from 'node:module';
const original = Module._load;
Module._load = function(name, ...args) {
  if (String(name).includes('playwright')) {
    const error = new Error('시험 환경에 Playwright가 없어요.');
    error.code = 'MODULE_NOT_FOUND';
    throw error;
  }
  return original.call(this, name, ...args);
};`;

function runWithoutBrowser(file) {
  const env = {
    ...process.env,
    SCHAT_PLAYWRIGHT_MODULE: "",
    SCHAT_BROWSER_CHANNEL: "",
  };
  delete env.NODE_TEST_CONTEXT;
  return spawnSync(
    process.execPath,
    [
      "--import",
      `data:text/javascript,${encodeURIComponent(withoutPlaywright)}`,
      "--test",
      fileURLToPath(new URL(file, import.meta.url)),
    ],
    {
      encoding: "utf8",
      env,
    }
  );
}

test("일반 도움말 검증은 Playwright가 없는 설치에서도 통과함", () => {
  const result = runWithoutBrowser("./inlineHelp.node.test.mjs");
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /도움말은 처음 접혀/);
});

test("별도 브라우저 검증은 Playwright가 없으면 설치 안내와 실패를 반환함", () => {
  const result = runWithoutBrowser("./inlineHelp.browser.test.mjs");
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout + result.stderr, /SCHAT_PLAYWRIGHT_MODULE/);
});
