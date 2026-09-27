from __future__ import annotations

import importlib.util
import json
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
BUILDER = ROOT / "문서도구" / "문서화면_만들기.py"


def load_builder():
    spec = importlib.util.spec_from_file_location("schat_docs_view_builder", BUILDER)
    if spec is None or spec.loader is None:
        raise RuntimeError("문서 화면 생성기를 불러올 수 없습니다.")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class SchatOverviewPageTest(unittest.TestCase):
    def test_renders_six_readable_sections_and_public_data(self):
        builder = load_builder()
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "docs_view"
            builder.build_docs_view(ROOT, output)
            page = (output / "index.html").read_text(encoding="utf-8")
            data = json.loads((output / "schat-overview-data.json").read_text(encoding="utf-8"))

        for heading in (
            "SCHAT 한눈에 보기",
            "어떻게 동작하나요?",
            "프로젝트 구성",
            "현재 상태와 안전장치",
            "변경 이력",
            "인수인계 안내",
        ):
            self.assertIn(heading, page)
        self.assertIn("<details", page)
        self.assertIn("@media(max-width:760px)", page)
        self.assertIn("application/json", page)
        self.assertIn("Docker", data["handover"]["html"])
        self.assertGreater(len(data["history"]), 0)

    def test_page_does_not_expose_secrets_or_registered_document_content(self):
        builder = load_builder()
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "docs_view"
            builder.build_docs_view(ROOT, output)
            page = (output / "index.html").read_text(encoding="utf-8")
            public_json = (output / "schat-overview-data.json").read_text(encoding="utf-8")

        combined = page + public_json
        self.assertNotIn("GEMINI_API_KEY=", combined)
        self.assertNotIn("SCHAT_TEST_EMPLOYEE_PASSWORD", combined)
        self.assertNotIn("server/storage", combined)
        self.assertNotIn(".pdf · p.", combined)


if __name__ == "__main__":
    unittest.main()
