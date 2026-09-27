from __future__ import annotations

import argparse
import subprocess
import sys
from pathlib import Path
from typing import Callable, Iterable


MONITORED_PREFIXES = (
    "frontend/",
    "server/",
    "collector/",
    "docker/",
    "safety_evaluator/",
    "검사/",
    "문서도구/",
    "docs/00_현재상태/",
    "docs/01_작업일지/",
    "05_인수인계/",
)
MONITORED_FILES = {"package.json", "docker-compose.yml", "AGENTS.md"}


def should_refresh(paths: Iterable[str]) -> bool:
    for raw_path in paths:
        path = raw_path.replace("\\", "/").lstrip("./")
        if path in MONITORED_FILES or path.startswith(MONITORED_PREFIXES):
            return True
    return False


def refresh_overview(
    repository_root: Path,
    runner: Callable[..., subprocess.CompletedProcess] = subprocess.run,
) -> bool:
    root = repository_root.resolve()
    builder = root / "문서도구/문서화면_만들기.py"
    try:
        runner([sys.executable, str(builder)], cwd=root, check=True)
        return True
    except (OSError, subprocess.SubprocessError) as error:
        print(f"[SCHAT 문서] 자동 갱신을 건너뜁니다: {error}", file=sys.stderr)
        return False


def _staged_paths(root: Path) -> list[str]:
    try:
        result = subprocess.run(
            ["git", "diff", "--cached", "--name-only"],
            cwd=root,
            check=True,
            capture_output=True,
            text=True,
        )
        return [line for line in result.stdout.splitlines() if line]
    except (OSError, subprocess.SubprocessError) as error:
        print(f"[SCHAT 문서] staged 파일 확인을 건너뜁니다: {error}", file=sys.stderr)
        return []


def _stage_outputs(root: Path) -> None:
    try:
        subprocess.run(
            ["git", "add", "docs_view/index.html", "docs_view/schat-overview-data.json"],
            cwd=root,
            check=True,
        )
    except (OSError, subprocess.SubprocessError) as error:
        print(f"[SCHAT 문서] 생성 파일 자동 stage를 건너뜁니다: {error}", file=sys.stderr)


def main() -> int:
    parser = argparse.ArgumentParser(description="SCHAT 설명 화면 비차단 자동 갱신")
    parser.add_argument("--all", action="store_true", help="변경 경로 확인 없이 갱신")
    parser.add_argument("--staged", action="store_true", help="staged 경로가 관련될 때만 갱신")
    parser.add_argument("--stage-output", action="store_true", help="생성된 화면을 stage")
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1]

    if args.staged and not should_refresh(_staged_paths(root)):
        return 0
    if not args.all and not args.staged:
        args.all = True

    if refresh_overview(root) and args.stage_output:
        _stage_outputs(root)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
