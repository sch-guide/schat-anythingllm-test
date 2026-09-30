from __future__ import annotations

import importlib.util
import json
import re
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
            "현재 상태와 검증 결과",
            "백업과 안전장치",
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
        self.assertNotIn(".pdf · p.", combined)
        # The approved server deployment guide (05_인수인계, 2026-09-28) names
        # the server data folder in its commands. Anywhere else on the page
        # the storage path must still never appear.
        outside_guides = re.sub(
            r'<(?:div|details) class="[^"]*guide-block[^"]*".*?<!--/guide-->', "", page, flags=re.S
        )
        self.assertNotIn("server/storage", outside_guides + public_json)

    def test_mentoring_overview_is_primary_and_evidence_is_collapsed(self):
        """상세근거를 다시 항상 펼쳐 보이게 만드는 변경을 막는다."""
        builder = load_builder()
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "docs_view"
            builder.build_docs_view(ROOT, output)
            page = (output / "index.html").read_text(encoding="utf-8")

        mentoring = re.search(
            r'<section id="mentoring">.*?</section>', page, re.S
        ).group(0)
        self.assertIn("멘토링 조언 이행 현황", mentoring)
        self.assertIn('<details class="mentoring-evidence">', mentoring)
        self.assertIn("▶ 자세한 근거 보기", mentoring)
        evidence = re.search(
            r'<details class="mentoring-evidence">.*?</details>', mentoring, re.S
        ).group(0)
        self.assertIn("2026-09-19 멘토링 조언과 이행 현황", evidence)


if __name__ == "__main__":
    unittest.main()
