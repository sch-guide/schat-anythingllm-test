import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const updater = path.join(root, "문서도구", "SCHAT_설명화면_자동갱신.py");
const candidates = [];

if (process.env.SCHAT_OVERVIEW_PYTHON) {
  candidates.push({ command: process.env.SCHAT_OVERVIEW_PYTHON, prefix: [] });
}

const localPython = process.platform === "win32"
  ? path.resolve(root, "..", ".venv", "Scripts", "python.exe")
  : path.resolve(root, "..", ".venv", "bin", "python");
if (existsSync(localPython)) candidates.push({ command: localPython, prefix: [] });

if (process.platform === "win32") {
  candidates.push({ command: "py", prefix: ["-3"] });
  candidates.push({ command: "python", prefix: [] });
} else {
  candidates.push({ command: "python3", prefix: [] });
  candidates.push({ command: "python", prefix: [] });
}

let attempted = false;
for (const candidate of candidates) {
  const result = spawnSync(
    candidate.command,
    [...candidate.prefix, updater, "--all"],
    { cwd: root, stdio: "inherit" }
  );
  if (result.error?.code === "ENOENT") continue;
  attempted = true;
  if (!result.error && result.status === 0) {
    console.log("[SCHAT 문서] 설명 화면을 현재 저장소 기준으로 갱신했습니다.");
    process.exit(0);
  }
}

console.warn(
  attempted
    ? "[SCHAT 문서] 자동 갱신에 실패했지만 앱 실행과 build는 계속합니다."
    : "[SCHAT 문서] Python을 찾지 못해 자동 갱신을 건너뛰지만 앱 실행과 build는 계속합니다."
);
process.exit(0);

