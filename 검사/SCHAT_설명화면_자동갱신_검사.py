from __future__ import annotations

import importlib.util
import subprocess
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
AUTOMATION = ROOT / "문서도구" / "SCHAT_설명화면_자동갱신.py"


def load_automation():
    spec = importlib.util.spec_from_file_location("schat_overview_automation", AUTOMATION)
    if spec is None or spec.loader is None:
        raise RuntimeError("SCHAT 설명 화면 자동 갱신기를 불러올 수 없습니다.")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class SchatOverviewAutomationTest(unittest.TestCase):
    def test_detects_only_changes_that_can_affect_the_overview(self):
        automation = load_automation()

        for path in (
            "frontend/src/main.jsx",
            "server/utils/chats/stream.js",
            "collector/processSingleFile/index.js",
            "docker/docker-compose.yml",
            "검사/검색설정_검사.node.cjs",
            "문서도구/문서화면_만들기.py",
            "docs/00_현재상태/현재_프로젝트_상태.md",
            "docs/01_작업일지/2026-09-25_작업.md",
            "05_인수인계/SCHAT_인수인계.md",
            "package.json",
        ):
            self.assertTrue(automation.should_refresh([path]), path)

        self.assertFalse(automation.should_refresh(["LICENSE", "README.md"]))
        self.assertFalse(automation.should_refresh(["docs/superpowers/plans/example.md"]))

    def test_refresh_failure_is_reported_without_raising_or_blocking(self):
        automation = load_automation()

        def failing_runner(*args, **kwargs):
            raise subprocess.CalledProcessError(1, args[0])

        with tempfile.TemporaryDirectory() as directory:
            success = automation.refresh_overview(Path(directory), runner=failing_runner)

        self.assertFalse(success)

    def test_refresh_invokes_the_existing_builder(self):
        automation = load_automation()
        calls = []

        def successful_runner(command, **kwargs):
            calls.append((command, kwargs))
            return subprocess.CompletedProcess(command, 0)

        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "문서도구").mkdir()
            (root / "문서도구/문서화면_만들기.py").write_text("", encoding="utf-8")
            success = automation.refresh_overview(root, runner=successful_runner)

        self.assertTrue(success)
        self.assertEqual(len(calls), 1)
        self.assertEqual(Path(calls[0][0][1]).name, "문서화면_만들기.py")
        self.assertEqual(calls[0][1]["cwd"], root)


if __name__ == "__main__":
    unittest.main()
