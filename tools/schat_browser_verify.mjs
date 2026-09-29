#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

const chrome = process.env.SCHAT_CHROME_PATH;
const token = process.env.SCHAT_TEST_AUTH_TOKEN;
const user = JSON.parse(process.env.SCHAT_TEST_AUTH_USER || "null");
const threadSlug = process.env.SCHAT_TEST_THREAD_SLUG;
const origin = "http://127.0.0.1:3001";
if (!chrome || !token || !user || !threadSlug) throw new Error("missing_browser_input");

const profile = fs.mkdtempSync(path.join(os.tmpdir(), "schat-browser-"));
const port = 9339;
const child = spawn(chrome, [
  "--headless=new",
  "--disable-gpu",
  "--no-first-run",
  "--no-default-browser-check",
  `--remote-debugging-port=${port}`,
  `--user-data-dir=${profile}`,
  "about:blank",
], { stdio: "ignore" });

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function waitJson(url, attempts = 50) {
  for (let i = 0; i < attempts; i += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) return response.json();
    } catch {}
    await delay(200);
  }
  throw new Error("chrome_debug_endpoint_unavailable");
}

let seq = 0;
const pending = new Map();
function makeClient(wsUrl) {
  const ws = new WebSocket(wsUrl);
  ws.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    const handler = pending.get(message.id);
    if (!handler) return;
    pending.delete(message.id);
    message.error ? handler.reject(new Error(message.error.message)) : handler.resolve(message.result);
  });
  const opened = new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve, { once: true });
    ws.addEventListener("error", reject, { once: true });
  });
  return {
    opened,
    send(method, params = {}) {
      const id = ++seq;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        ws.send(JSON.stringify({ id, method, params }));
      });
    },
    close: () => ws.close(),
  };
}

async function expression(client, source) {
  const result = await client.send("Runtime.evaluate", {
    expression: source,
    returnByValue: true,
    awaitPromise: true,
  });
  return result.result?.value;
}

try {
  await waitJson(`http://127.0.0.1:${port}/json/version`);
  const page = await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(origin)}`, { method: "PUT" }).then((r) => r.json());
  const client = makeClient(page.webSocketDebuggerUrl);
  await client.opened;
  await client.send("Page.enable");
  await client.send("Runtime.enable");
  await delay(1200);
  await expression(client, `localStorage.setItem('anythingllm_authToken', ${JSON.stringify(token)}); localStorage.setItem('anythingllm_user', ${JSON.stringify(JSON.stringify(user))}); localStorage.setItem('anythingllm_authTimestamp', String(Date.now())); true`);
  await client.send("Page.navigate", { url: `${origin}/workspace/schat-2026-09-22/t/${threadSlug}` });
  await delay(5000);

  const before = await expression(client, `(() => ({ text: document.body.innerText, citationButtons: [...document.querySelectorAll('button')].filter(b => /근거 원문 보기/.test(b.innerText)).length }))()`);
  await expression(client, `(() => { const b=[...document.querySelectorAll('button')].find(x => /근거 원문 보기/.test(x.innerText)); if(b) b.click(); return !!b; })()`);
  await delay(1800);
  const expanded = await expression(client, `(() => ({ text: document.body.innerText, iframeCount: document.querySelectorAll('iframe, embed, object').length }))()`);
  await client.send("Page.reload", { ignoreCache: true });
  await delay(5000);
  const reloaded = await expression(client, `(() => ({ text: document.body.innerText, citationButtons: [...document.querySelectorAll('button')].filter(b => /근거 원문 보기/.test(b.innerText)).length }))()`);
  const pages = (before.text.match(/p\.\s*\d+/g) || []).map((x) => x.replace(/\s/g, ""));
  process.stdout.write(JSON.stringify({
    loaded: /SCHAT|출처|근거 원문 보기/.test(before.text),
    citationButtons: before.citationButtons,
    pages: [...new Set(pages)],
    excerptOrViewerAfterExpand: /근거 원문|원본 PDF|PDF/.test(expanded.text) || expanded.iframeCount > 0,
    reloadCitationButtons: reloaded.citationButtons,
    reloadStable: reloaded.citationButtons === before.citationButtons,
  }));
  client.close();
} finally {
  child.kill();
  await delay(750);
  try {
    fs.rmSync(profile, { recursive: true, force: true, maxRetries: 4, retryDelay: 250 });
  } catch {}
}
