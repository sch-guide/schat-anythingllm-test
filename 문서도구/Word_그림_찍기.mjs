// Word 변환본에 넣을 그림을 문서 화면(docs_view)에서 찍는다.
// 사용: node 문서도구/Word_그림_찍기.mjs <index.html> <그림폴더> <선택자JSON>
// 결과: <그림폴더>/manifest.json — 메뉴별 그림 파일 순서와 크기(CSS px)
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const [htmlPath, outDir, selectorJson] = process.argv.slice(2);
const { visual, merged } = JSON.parse(selectorJson);
const CHROME =
  process.env.CHROME_PATH ||
  [
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  ].find((path) => existsSync(path));
if (!CHROME) throw new Error("Chrome 또는 Edge를 찾지 못했습니다. CHROME_PATH를 지정해 주세요.");

const PORT = 9400 + Math.floor(Math.random() * 400);
const WIDTH = 1100;
const SCALE = 2;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
mkdirSync(outDir, { recursive: true });
const profile = mkdtempSync(join(tmpdir(), "schat-word-"));
const chrome = spawn(
  CHROME,
  [`--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, "--headless=new", "--no-first-run", "--allow-file-access-from-files", "about:blank"],
  { stdio: "ignore" }
);

let ready = false;
for (let i = 0; i < 60 && !ready; i++) {
  try {
    await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json();
    ready = true;
  } catch {
    await sleep(250);
  }
}
const target = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).find((t) => t.type === "page");
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r));
let id = 0;
const pending = new Map();
ws.addEventListener("message", (event) => {
  const message = JSON.parse(event.data);
  if (message.id && pending.has(message.id)) {
    pending.get(message.id)(message.result);
    pending.delete(message.id);
  }
});
const send = (method, params = {}) =>
  new Promise((done) => {
    const i = ++id;
    pending.set(i, done);
    ws.send(JSON.stringify({ id: i, method, params }));
  });
const evaluate = async (expression) =>
  (await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true })).result.value;

async function open(url) {
  await send("Emulation.setDeviceMetricsOverride", { width: WIDTH, height: 1200, deviceScaleFactor: SCALE, mobile: false });
  await send("Page.navigate", { url });
  await sleep(1500);
  // 긴 화면을 찍을 때 스크롤바가 사라지며 폭이 바뀌지 않도록 처음부터 숨긴다.
  await evaluate(`(() => { const s = document.createElement('style'); s.textContent = '::-webkit-scrollbar{width:0!important;height:0!important}html{scrollbar-width:none}'; document.head.appendChild(s); return true; })()`);
  await evaluate("document.fonts ? document.fonts.ready.then(() => true) : true");
}

async function shot(rect, file) {
  const result = await send("Page.captureScreenshot", {
    format: "png",
    captureBeyondViewport: true,
    clip: { x: rect.x, y: rect.y, width: rect.width, height: rect.height, scale: 1 },
  });
  writeFileSync(join(outDir, file), Buffer.from(result.data, "base64"));
  return { file, width: Math.round(rect.width), height: Math.round(rect.height) };
}

const manifest = { pages: {}, merged: [] };

// 1) 문서 화면: 모든 메뉴와 접힌 칸을 펼친 뒤 색깔 상자·그림을 순서대로 찍는다.
await open(pathToFileURL(resolve(htmlPath)).href);
await evaluate(`(async () => {
  document.querySelectorAll('.page').forEach(p => { p.hidden = false; });
  document.querySelectorAll('details').forEach(d => { d.open = true; });
  // 구조도는 Word에서 크게 보이도록 한 줄에 하나씩 놓고, 늦게 불러오는 그림을 모두 불러온다.
  document.querySelectorAll('.mentoring-diagrams').forEach(g => { g.style.gridTemplateColumns = '1fr'; });
  const imgs = [...document.images];
  imgs.forEach(i => { i.loading = 'eager'; });
  await Promise.all(imgs.map(i => i.complete && i.naturalWidth ? null : new Promise(r => { i.onload = i.onerror = r; setTimeout(r, 5000); })));
  return true;
})()`);
await sleep(500);
const rects = await evaluate(`(() => {
  const selector = ${JSON.stringify(visual)};
  const out = {};
  document.querySelectorAll('.page').forEach(page => {
    const found = [...page.querySelectorAll(selector)].filter(el => !el.parentElement.closest(selector));
    out[page.id] = found.map(el => {
      const r = el.getBoundingClientRect();
      return { x: r.left + scrollX, y: r.top + scrollY, width: r.width, height: r.height };
    });
  });
  return out;
})()`);
await sleep(800);
for (const [page, list] of Object.entries(rects)) {
  manifest.pages[page] = [];
  for (const [index, rect] of list.entries()) {
    const pad = 4;
    manifest.pages[page].push(
      await shot({ x: rect.x - pad, y: rect.y - pad, width: rect.width + pad * 2, height: rect.height + pad * 2 }, `${page}_${index + 1}.png`)
    );
  }
}

// 2) 통합 아키텍처: 화면 안 작은 창(iframe) 대신 원래 문서를 열고 제목(h2) 단위로 나누어 찍는다.
const mergedPath = join(dirname(resolve(htmlPath)), merged);
if (existsSync(mergedPath)) {
  await open(pathToFileURL(mergedPath).href);
  const parts = await evaluate(`(() => {
    const main = document.querySelector('main');
    const box = main.getBoundingClientRect();
    const cuts = [box.top + scrollY, ...[...main.querySelectorAll(':scope > h2')].map(h => h.getBoundingClientRect().top + scrollY - 12), box.bottom + scrollY];
    const parts = [];
    for (let i = 0; i < cuts.length - 1; i++) {
      if (cuts[i + 1] - cuts[i] > 20) parts.push({ x: box.left + scrollX, y: cuts[i], width: box.width, height: cuts[i + 1] - cuts[i] });
    }
    return parts;
  })()`);
  for (const [index, rect] of parts.entries()) {
    manifest.merged.push(await shot(rect, `merged_${index + 1}.png`));
  }
}

// 3) 구조도 SVG: 원래 크기대로 따로 열어 선명하게 찍는다.
manifest.svgs = {};
const svgDir = join(dirname(resolve(htmlPath)), "assets", "mentoring");
for (const name of readdirSync(svgDir).filter((f) => f.endsWith(".svg"))) {
  const header = readFileSync(join(svgDir, name), "utf-8").slice(0, 600);
  const width = Number((header.match(/width="(\d+)"/) || [])[1] || 1200);
  const height = Number((header.match(/height="(\d+)"/) || [])[1] || 600);
  await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: SCALE, mobile: false });
  await send("Page.navigate", { url: pathToFileURL(join(svgDir, name)).href });
  await sleep(800);
  const file = `svg_${Object.keys(manifest.svgs).length + 1}.png`;
  manifest.svgs[name] = await shot({ x: 0, y: 0, width, height }, file);
}

writeFileSync(join(outDir, "manifest.json"), JSON.stringify(manifest, null, 2));
ws.close();
chrome.kill();
await sleep(500);
try {
  rmSync(profile, { recursive: true, force: true });
} catch {}
console.log(`그림 ${Object.values(manifest.pages).flat().length + manifest.merged.length}장을 찍었습니다.`);
process.exit(0);
