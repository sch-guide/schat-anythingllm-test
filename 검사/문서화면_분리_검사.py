from __future__ import annotations

import importlib.util
import json
import re
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BUILDER_PATH = ROOT / "문서도구" / "문서화면_만들기.py"


def load_builder():
    spec = importlib.util.spec_from_file_location("schat_test_docs_builder", BUILDER_PATH)
    if spec is None or spec.loader is None:
        raise RuntimeError("문서 화면 생성기를 읽을 수 없습니다.")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class DocsViewIsolationTest(unittest.TestCase):
    def test_optional_upstream_folders_are_removed_but_preserved_sources_stay(self):
        removed = (
            ".devcontainer",
            "browser-extension",
            "cloud-deployments",
            "images",
            "locales",
        )
        required = (
            "frontend",
            "server",
            "collector",
            "docker",
            "open-computer",
            "embed",
            "extras",
        )

        self.assertTrue(all(not (ROOT / name).exists() for name in removed))
        self.assertTrue(all((ROOT / name).is_dir() for name in required))
        self.assertTrue((ROOT / ".gitmodules").is_file())

    def test_repository_rules_require_docs_view_refresh(self):
        rules = (ROOT / "AGENTS.md").read_text(encoding="utf-8")

        self.assertIn("docs/00_현재상태/현재_프로젝트_상태.md", rules)
        self.assertIn("docs/01_작업일지", rules)
        self.assertIn("문서도구/문서화면_만들기.py", rules)
        self.assertIn("검사/문서화면_분리_검사.py", rules)

    def test_easy_workspace_uses_only_this_repository(self):
        workspace = json.loads(
            (ROOT / "SCHAT_테스트_쉬운화면.code-workspace").read_text(encoding="utf-8")
        )

        self.assertGreaterEqual(len(workspace["folders"]), 4)
        for item in workspace["folders"]:
            self.assertNotIn("..", Path(item["path"]).parts)
            self.assertTrue((ROOT / item["path"]).exists())

    def test_easy_workspace_puts_frequent_views_first(self):
        workspace = json.loads(
            (ROOT / "SCHAT_테스트_쉬운화면.code-workspace").read_text(encoding="utf-8")
        )

        self.assertEqual(
            workspace["folders"],
            [
                {"name": "00_웹으로_보는_문서", "path": "docs_view"},
                {"name": "01_현재상태", "path": "docs/00_현재상태"},
                {"name": "02_작업일지", "path": "docs/01_작업일지"},
                {"name": "03_전체_공식문서", "path": "docs"},
                {"name": "04_화면디자인", "path": "04_화면디자인"},
                {"name": "05_인수인계", "path": "05_인수인계"},
                {"name": "90_개발자용_프로그램파일", "path": "."},
            ],
        )

        self.assertTrue((ROOT / "04_화면디자인" / "README.md").is_file())
        self.assertFalse((ROOT / "docs" / "04_화면디자인").exists())
        self.assertTrue((ROOT / "05_인수인계" / "SCHAT_인수인계.md").is_file())
        self.assertFalse((ROOT / "docs" / "02_인수인계").exists())

    def test_official_docs_view_hides_sections_already_shown_separately(self):
        workspace = json.loads(
            (ROOT / "SCHAT_테스트_쉬운화면.code-workspace").read_text(encoding="utf-8")
        )
        excluded = workspace["settings"]["files.exclude"]

        self.assertTrue(excluded.get("00_현재상태", False))
        self.assertTrue(excluded.get("01_작업일지", False))
        self.assertTrue(excluded.get("04_화면디자인", False))
        self.assertTrue(excluded.get("05_인수인계", False))

    def test_developer_section_does_not_hide_runtime_folders(self):
        folder_settings = json.loads(
            (ROOT / ".vscode" / "settings.json").read_text(encoding="utf-8")
        )
        excluded = folder_settings.get("files.exclude", {})

        for name in ("frontend", "server", "collector", "docker", "open-computer"):
            self.assertFalse(excluded.get(name, False), name)

    def test_generated_view_contains_only_test_repository_documents(self):
        builder = load_builder()
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "docs_view"
            builder.build_docs_view(ROOT, output)
            html = (output / "index.html").read_text(encoding="utf-8")
            overview_data_exists = (output / "schat-overview-data.json").is_file()

        self.assertIn("SCHAT 기능 비교 테스트", html)
        self.assertIn("SCHAT 한눈에 보기", html)
        self.assertIn("현재 상태와 안전장치", html)
        self.assertIn("변경 이력 보기", html)
        self.assertIn("인수인계 안내", html)
        self.assertIn("schat-overview-data", html)
        self.assertTrue(overview_data_exists)
        self.assertNotIn("docs/superpowers", html)
        self.assertNotIn("문서종류:", html)
        self.assertNotIn("주제:", html)
        self.assertNotIn("GEMINI_API_KEY=", html)
        self.assertNotIn("server/storage", html)

    def test_saved_view_matches_fresh_generation(self):
        builder = load_builder()
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "docs_view"
            builder.build_docs_view(ROOT, output)
            expected = (output / "index.html").read_bytes()

        actual = (ROOT / "docs_view" / "index.html").read_bytes()
        self.assertEqual(actual, expected)

    def test_official_document_links_point_to_existing_files(self):
        link_pattern = re.compile(r"\[[^]]+\]\(([^)]+)\)")
        broken: list[tuple[str, str]] = []

        for document in (ROOT / "docs").rglob("*.md"):
            for target in link_pattern.findall(document.read_text(encoding="utf-8")):
                if target.startswith(("http://", "https://", "#")):
                    continue
                if not (document.parent / target).resolve().exists():
                    broken.append((str(document.relative_to(ROOT)), target))

        self.assertEqual(broken, [])


if __name__ == "__main__":
    unittest.main()
