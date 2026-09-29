#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";

const root = path.resolve(import.meta.dirname, "..");
const docker = "C:\\Users\\박보하\\AppData\\Local\\Programs\\DockerDesktop\\resources\\bin\\docker.exe";
const chrome = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const lifecycleLocal = path.join(root, "tools", "schat_temp_employee_session.js");
const lifecycleContainer = "/tmp/schat_temp_employee_session.js";
const resultPath = path.join(root, "docs", "02_멘토링", "산출물_2026-09-30", "로컬전용_원자료", "SCHAT_21문항_근거선택개선_실행결과.json");

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
    ...options,
  });
  if (result.status !== 0) {
    throw new Error(`${path.basename(command)} failed: ${String(result.stderr || "").trim()}`);
  }
  return String(result.stdout || "").trim();
}

function parseLastJson(output) {
  const lines = String(output).split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  return JSON.parse(lines.at(-1));
}

function runStreaming(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: root, stdio: "inherit", ...options });
    child.once("error", reject);
    child.once("exit", (code) => code === 0 ? resolve() : reject(new Error(`${path.basename(command)} exited ${code}`)));
  });
}

let session = null;
try {
  run(docker, ["cp", lifecycleLocal, `schat-web:${lifecycleContainer}`]);
  session = parseLastJson(run(docker, ["exec", "-w", "/app/server", "schat-web", "node", lifecycleContainer, "create"]));
  process.stdout.write("로컬 테스트 전용 직원 계정을 만들고 30분 세션을 발급했습니다.\n");

  await runStreaming(process.execPath, ["tools/schat_1_0_live_review.mjs"], {
    env: {
      ...process.env,
      SCHAT_TEST_AUTH_TOKEN: session.token,
    },
  });
  const evaluation = JSON.parse(fs.readFileSync(resultPath, "utf8"));
  const target = evaluation.results.find((row) => row.id === "UAT-S04") || evaluation.results[0];
  const browserSummary = run(process.execPath, ["tools/schat_browser_verify.mjs"], {
    env: {
      ...process.env,
      SCHAT_CHROME_PATH: chrome,
      SCHAT_TEST_AUTH_TOKEN: session.token,
      SCHAT_TEST_AUTH_USER: JSON.stringify(session.user),
      SCHAT_TEST_THREAD_SLUG: target.thread_slug,
    },
  });
  fs.writeFileSync(
    path.join(path.dirname(resultPath), "SCHAT_21문항_브라우저검증.json"),
    `${JSON.stringify(JSON.parse(browserSummary), null, 2)}\n`,
    "utf8"
  );
  process.stdout.write(`브라우저 검증: ${browserSummary}\n`);
} finally {
  if (session?.user?.id) {
    const cleanup = parseLastJson(run(docker, [
      "exec", "-e", `SCHAT_TEMP_USER_ID=${session.user.id}`, "-w", "/app/server",
      "schat-web", "node", lifecycleContainer, "cleanup",
    ]));
    const response = await fetch("http://127.0.0.1:3001/api/system/check-token", {
      headers: { Authorization: `Bearer ${session.token}` },
    }).catch(() => null);
    process.stdout.write(`임시 계정 정리: ${JSON.stringify({ ...cleanup, tokenRejected: response ? !response.ok : true })}\n`);
  }
}
