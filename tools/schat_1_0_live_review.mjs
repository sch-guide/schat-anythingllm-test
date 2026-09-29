#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const outputDir = path.join(root, "docs", "02_멘토링", "산출물_2026-09-30", "로컬전용_원자료");
const token = process.env.SCHAT_TEST_AUTH_TOKEN;
const origin = "http://127.0.0.1:3001";
const workspace = "schat-2026-09-22";
if (!token) throw new Error("missing_test_auth_token");

const headers = { "content-type": "application/json", authorization: `Bearer ${token}` };
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function publicSource(source = {}) {
  return {
    title: source.title || source.documentName || source.document_name || "",
    page: source.page ?? null,
    section: source.section || "",
    score: source.score ?? null,
    excerpt: source.excerpt || source.text || "",
  };
}

async function createThread() {
  const response = await fetch(`${origin}/api/workspace/${workspace}/thread/new`, {
    method: "POST", headers, body: "{}",
  });
  const payload = await response.json();
  if (!response.ok || !payload.thread?.slug) throw new Error("thread_create_failed");
  return payload.thread.slug;
}

function parseSse(text) {
  return text.split(/\r?\n/).filter((line) => line.startsWith("data: ")).map((line) => {
    try { return JSON.parse(line.slice(6)); } catch { return null; }
  }).filter(Boolean);
}

async function history(threadSlug) {
  const response = await fetch(`${origin}/api/workspace/${workspace}/thread/${threadSlug}/chats`, { headers });
  if (!response.ok) throw new Error(`history_http_${response.status}`);
  return (await response.json()).history || [];
}

async function runQuestion(question, threadSlug) {
  const initial = await fetch(`${origin}/api/workspace/${workspace}/thread/${threadSlug}/stream-chat`, {
    method: "POST", headers, body: JSON.stringify({ message: question, mode: "chat" }),
  });
  const initialEvents = parseSse(await initial.text());
  const init = initialEvents.find((event) => event.type === "agentInitWebsocketConnection");
  if (!initial.ok || !init?.websocketUUID) throw new Error("agent_websocket_init_failed");

  const socketEvents = [];
  await new Promise((resolve, reject) => {
    const socket = new WebSocket(`ws://127.0.0.1:3001/api/agent-invocation/${init.websocketUUID}`);
    const timeout = setTimeout(() => {
      socket.close();
      reject(new Error("agent_websocket_timeout"));
    }, 180_000);
    socket.addEventListener("message", (event) => {
      try { socketEvents.push(JSON.parse(event.data)); } catch {}
    });
    socket.addEventListener("close", () => { clearTimeout(timeout); resolve(); }, { once: true });
    socket.addEventListener("error", () => { clearTimeout(timeout); reject(new Error("agent_websocket_error")); }, { once: true });
  });

  let messages = [];
  for (let attempt = 0; attempt < 20; attempt += 1) {
    messages = await history(threadSlug);
    if ([...messages].reverse().find((message) => message.role === "assistant" && message.content)) break;
    await delay(250);
  }
  const assistant = [...messages].reverse().find((message) => message.role === "assistant" && message.content);
  if (!assistant) throw new Error("assistant_history_missing");
  return {
    answer: assistant.content,
    sources: (assistant.sources || []).map(publicSource),
    metrics: assistant.metrics || {},
    event_types: [...new Set([...initialEvents, ...socketEvents].map((event) => event.type).filter(Boolean))],
  };
}

const a8 = JSON.parse(fs.readFileSync(path.join(outputDir, "A8_현재운영_21문항_재평가.json"), "utf8"));
const cases = a8.cases.hybrid;
const results = [];
let requestCount = 0;
for (const item of cases) {
  const threadSlug = await createThread();
  let contextFixture = null;
  if (item.case_id === "UAT-S12") {
    contextFixture = "진정은 어떻게 진행하는 거야?";
    await runQuestion(contextFixture, threadSlug);
    requestCount += 1;
  }
  const row = await runQuestion(item.question, threadSlug);
  requestCount += 1;
  results.push({
    id: item.case_id,
    question: item.question,
    thread_slug: threadSlug,
    gold_document: item.gold_document,
    gold_pages: item.gold_pages,
    context_fixture: contextFixture,
    http_status: 200,
    error: null,
    ...row,
  });
  process.stdout.write(`${JSON.stringify({ id: item.case_id, source_count: row.sources.length, answer_present: !!row.answer })}\n`);
}
fs.writeFileSync(
  path.join(outputDir, "SCHAT_21문항_근거선택개선_실행결과.json"),
  `${JSON.stringify({ scope: "a8", question_count: results.length, retry_count: 0, automatic_request_count: requestCount, results }, null, 2)}\n`,
  "utf8"
);
