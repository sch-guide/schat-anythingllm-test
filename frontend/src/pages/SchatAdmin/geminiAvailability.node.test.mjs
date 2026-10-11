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
test("fee presentation uses common help and independent low balance warnings", async () => {
  const result = await build({
    stdin: {
      contents: `import React from 'react'; import {renderToStaticMarkup as render} from 'react-dom/server'; import {GeminiBudgetSummary} from './src/pages/SchatAdmin/GeminiBudgetPanel.jsx'; import {GeminiAvailabilityNotice} from './src/pages/SchatAdmin/GeminiAvailabilityBanner.jsx'; export const missing=render(<GeminiBudgetSummary budget={{percent:null,estimatedKrw:null,level:'unavailable'}}/>); export const warning=render(<GeminiAvailabilityNotice alerts={[]} budget={{percent:81,remainingKrw:190,questionsRemaining:null,level:'warning'}}/>); export const high=render(<GeminiAvailabilityNotice alerts={[]} budget={{percent:100,remainingKrw:0,questionsRemaining:0,level:'high'}}/>); export const low=render(<GeminiAvailabilityNotice alerts={[]} budget={{percent:80,remainingKrw:200,level:'normal'}}/>);`,
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
  assert.match(m.exports.warning, /AI 요금 충전 필요/);
  assert.match(m.exports.warning, /남은 돈 약 200원/);
  assert.match(m.exports.warning, /아직 계산 중이에요/);
  assert.doesNotMatch(m.exports.warning, /한도가 소진됨/);
  assert.match(m.exports.high, /남은 돈 약 0원/);
  assert.match(m.exports.high, /bg-red-50/);
  assert.equal(m.exports.low, "");
  assert.match(m.exports.warning, /schat-help__toggle/);
  assert.match(m.exports.warning, /aria-expanded="false"/);
  assert.doesNotMatch(m.exports.missing + m.exports.warning, /role="tooltip"/);
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
