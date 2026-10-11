import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../.."
);
const require = createRequire(import.meta.url);
test("budget presentation shows unavailable instead of zero and independent 80/95 warnings", async () => {
  const result = await build({
    stdin: {
      contents: `import React from 'react'; import {renderToStaticMarkup as render} from 'react-dom/server'; import {GeminiBudgetSummary} from './src/pages/SchatAdmin/GeminiBudgetPanel.jsx'; import {GeminiAvailabilityNotice} from './src/pages/SchatAdmin/GeminiAvailabilityBanner.jsx'; export const missing=render(<GeminiBudgetSummary budget={{percent:null,estimatedKrw:null,level:'unavailable'}}/>); export const warning=render(<GeminiAvailabilityNotice alerts={[]} budget={{percent:80,remainingPercent:20,level:'warning'}}/>); export const high=render(<GeminiAvailabilityNotice alerts={[]} budget={{percent:95,remainingPercent:5,level:'high'}}/>); export const low=render(<GeminiAvailabilityNotice alerts={[]} budget={{percent:79,remainingPercent:21,level:'normal'}}/>);`,
      resolveDir: root,
      loader: "jsx",
    },
    bundle: true,
    write: false,
    platform: "node",
    format: "cjs",
    jsx: "automatic",
    alias: { "@": path.join(root, "src") },
    define: { "import.meta.env.VITE_API_BASE": '"/api"' },
    plugins: [
      {
        name: "headers",
        setup(api) {
          api.onLoad({ filter: /utils[\\/]request\.js$/ }, () => ({
            contents: "export const baseHeaders=()=>({})",
            loader: "js",
          }));
        },
      },
    ],
  });
  const m = { exports: {} };
  new Function("module", "exports", "require", result.outputFiles[0].text)(
    m,
    m.exports,
    require
  );
  assert.match(m.exports.missing, /계산 불가/);
  assert.doesNotMatch(m.exports.missing, />0(?:원|%)/);
  assert.match(
    m.exports.missing,
    /문서 검색 자료 만들기, PDF 이미지 설명, 퀴즈 생성, 동의어 자동 생성/
  );
  assert.match(m.exports.warning, /80%/);
  assert.match(m.exports.warning, /주의/);
  assert.doesNotMatch(m.exports.warning, /한도가 소진됨/);
  assert.match(m.exports.high, /높은 사용량 경고/);
  assert.equal(m.exports.low, "");
  // 작업 9 전까지 예산·배너의 기존 도움말 표시를 그대로 보존해요.
  assert.equal((m.exports.missing.match(/role="tooltip"/g) || []).length, 2);
  assert.equal((m.exports.warning.match(/role="tooltip"/g) || []).length, 1);
  assert.match(m.exports.warning, />\(\?\)<\/button>/);
  assert.doesNotMatch(m.exports.missing + m.exports.warning, /schat-help__|aria-expanded=/);
});
test("administrator banner renders Korean first-occurrence time and disappears without alerts", async () => {
  const result = await build({
    stdin: {
      contents: `import React from 'react'; import {renderToStaticMarkup} from 'react-dom/server'; import {GeminiAvailabilityNotice} from './src/pages/SchatAdmin/GeminiAvailabilityBanner.jsx'; export const html=renderToStaticMarkup(<GeminiAvailabilityNotice alerts={[{firstOccurredAt:'2026-10-10T00:00:00.000Z'}]}/>); export const empty=renderToStaticMarkup(<GeminiAvailabilityNotice alerts={[]}/>);`,
      resolveDir: root,
      loader: "jsx",
    },
    bundle: true,
    write: false,
    platform: "node",
    format: "cjs",
    jsx: "automatic",
    alias: { "@": path.join(root, "src") },
    define: { "import.meta.env.VITE_API_BASE": '"/api"' },
    plugins: [
      {
        name: "headers",
        setup(api) {
          api.onLoad({ filter: /utils[\\/]request\.js$/ }, () => ({
            contents: "export const baseHeaders=()=>({})",
            loader: "js",
          }));
        },
      },
    ],
  });
  const m = { exports: {} };
  new Function("module", "exports", "require", result.outputFiles[0].text)(
    m,
    m.exports,
    require
  );
  assert.match(m.exports.html, /role="alert"/);
  assert.match(m.exports.html, /AI 사용 한도가 소진됨/);
  assert.match(m.exports.html, /(?:09:00:00|9시 0분 0초)/);
  assert.match(m.exports.html, /한국 시간/);
  assert.equal(m.exports.empty, "");
});
