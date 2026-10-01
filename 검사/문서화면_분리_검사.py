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

        # 저장소 폴더를 그대로 연 팀원에게도 공식 문서와 문서 화면이 보여야 한다.
        for name in ("frontend", "server", "collector", "docker", "open-computer", "docs", "docs_view"):
            self.assertFalse(excluded.get(name, False), name)

    def test_generated_view_contains_only_test_repository_documents(self):
        builder = load_builder()
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "docs_view"
            builder.build_docs_view(ROOT, output)
            html = (output / "index.html").read_text(encoding="utf-8")
            overview_data_exists = (output / "schat-overview-data.json").is_file()

        self.assertIn("SCHAT 병원 실무지침 AI 시스템", html)
        self.assertIn("SCHAT 한눈에 보기", html)
        self.assertIn("현재 상태와 검증 결과", html)
        self.assertIn("백업과 안전장치", html)
        self.assertIn("변경 이력 보기", html)
        self.assertIn("인수인계 안내", html)
        self.assertIn("schat-overview-data", html)
        self.assertTrue(overview_data_exists)
        self.assertNotIn("docs/superpowers", html)
        self.assertNotIn("문서종류:", html)
        self.assertNotIn("주제:", html)
        self.assertNotIn("GEMINI_API_KEY=", html)
        # Secret-shaped values are never allowed anywhere, including guides.
        self.assertIsNone(
            re.search(r"github_pat_[A-Za-z0-9_]{10,}|AIza[0-9A-Za-z_-]{20,}", html)
        )
        # Only the server deployment guide may name the server storage path
        # (its backup command needs it); the rest of the page may not.
        guide_pattern = r'<(?:div|details) class="[^"]*guide-block[^"]*" id="guide-\d+">.*?<!--/guide-->'
        guides = re.findall(guide_pattern, html, re.S)
        outside_guides = re.sub(guide_pattern, "", html, flags=re.S)
        self.assertNotIn("server/storage", outside_guides)
        self.assertTrue(any("서버 배포 및 업데이트 안내" in g for g in guides))
        # the deployment guide is shown inside the 인수인계 section, not as a
        # separate menu item
        handover = re.search(r'<section id="handover">.*?</section>', html, re.S).group(0)
        self.assertIn("서버 배포 및 업데이트 안내", handover)
        self.assertNotIn('href="#guide-', html)

    def test_five_menus_and_every_in_page_link_has_a_target(self):
        builder = load_builder()
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "docs_view"
            builder.build_docs_view(ROOT, output)
            html = (output / "index.html").read_text(encoding="utf-8")

        menus = re.findall(r'<nav id="site-nav"[^>]*>(.*?)</nav>', html, re.S)[0]
        self.assertEqual(
            re.findall(r'href="#([a-z]+)"', menus),
            ["intro", "how", "state", "journey", "ops"],
        )
        pages = re.findall(r'<div class="page" id="([a-z]+)"', html)
        self.assertEqual(pages, ["intro", "how", "state", "journey", "ops"])
        ids = set(re.findall(r'\sid="([^"]+)"', html))
        broken = sorted({target for target in re.findall(r'href="#([^"]*)"', html) if target not in ids})
        self.assertEqual(broken, [])
        # long documents are folded, and the current menu is marked
        self.assertIn('class="doc-panel', html)
        self.assertIn("aria-current", html)
        self.assertIn('class="menu-toggle"', html)

    def test_saved_view_matches_fresh_generation(self):
        builder = load_builder()
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "docs_view"
            builder.build_docs_view(ROOT, output)
            expected = (output / "index.html").read_bytes()

        actual = (ROOT / "docs_view" / "index.html").read_bytes()
        self.assertEqual(actual, expected)

    def test_generated_view_shows_four_mentoring_diagrams_as_images(self):
        builder = load_builder()
        expected_files = (
            "시스템_아키텍처.svg",
            "질문_처리_흐름.svg",
            "문서_등록_DFD.svg",
            "저장_구조_ERD.svg",
        )
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "docs_view"
            builder.build_docs_view(ROOT, output)
            html = (output / "index.html").read_text(encoding="utf-8")
            asset_dir = output / "assets" / "mentoring"

            for filename in expected_files:
                self.assertTrue((asset_dir / filename).is_file(), filename)
                self.assertIn(f"assets/mentoring/{filename}", html)

            self.assertGreaterEqual(html.count('class="mentoring-diagram"'), 4)

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
