from __future__ import annotations

import importlib.util
import json
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
GENERATOR = ROOT / "문서도구" / "SCHAT_개요데이터_만들기.py"


def load_generator():
    spec = importlib.util.spec_from_file_location("schat_overview_generator", GENERATOR)
    if spec is None or spec.loader is None:
        raise RuntimeError("SCHAT 개요 데이터 생성기를 불러올 수 없습니다.")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def make_fixture(root: Path, model: str = "gemini-fixture-flash") -> None:
    for folder in (
        "frontend",
        "server",
        "collector",
        "docker",
        "검사",
        "문서도구",
        "safety_evaluator",
        "docs/00_현재상태",
        "docs/01_작업일지",
        "05_인수인계",
    ):
        (root / folder).mkdir(parents=True, exist_ok=True)

    (root / "docker/docker-compose.yml").write_text(
        f"""services:
  schat-web:
    environment:
      GEMINI_LLM_MODEL_PREF: {model}
      EMBEDDING_MODEL_PREF: gemini-embedding-fixture
      VECTOR_DB: chroma
  chroma:
    container_name: schat-chromadb
    image: chromadb/chroma
  schat-safety-evaluator:
    image: safety
""",
        encoding="utf-8",
    )
    (root / "docker/.env").write_text(
        "GEMINI_API_KEY=secret-should-never-appear\nPASSWORD=hospital-password\n",
        encoding="utf-8",
    )
    (root / "server/schatBm25.js").write_text("function schatBm25() {}", encoding="utf-8")
    (root / "server/example.node.test.js").write_text("test('x', () => {})", encoding="utf-8")
    (root / "검사/example_test.py").write_text("def test_x(): pass", encoding="utf-8")
    (root / "검사/실행구성_검사.node.cjs").write_text("", encoding="utf-8")
    (root / "docs/00_현재상태/현재_프로젝트_상태.md").write_text(
        """# 현재 프로젝트 상태

## 완료
- 검색과 출처 표시

## 진행 중
- 이미지 검색 개선

## 예정
- 운영 검토
""",
        encoding="utf-8",
    )
    (root / "docs/01_작업일지/2026-09-25_설명화면.md").write_text(
        """# 2026-09-25 · 설명 화면 개선

비개발자가 프로젝트 구조를 쉽게 확인할 수 있도록 정리했습니다.
""",
        encoding="utf-8",
    )
    (root / "05_인수인계/SCHAT_인수인계.md").write_text(
        """# SCHAT 인수인계

## 시작하기

Docker 상태를 먼저 확인합니다.
""",
        encoding="utf-8",
    )


class SchatOverviewDataTest(unittest.TestCase):
    def test_collects_public_repository_facts_without_reading_secrets(self):
        generator = load_generator()
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            make_fixture(root)

            data = generator.collect_overview(root)
            serialized = json.dumps(data, ensure_ascii=False)

        self.assertEqual(data["technology"]["answerModel"]["value"], "gemini-fixture-flash")
        self.assertEqual(data["technology"]["embedding"]["value"], "gemini-embedding-fixture")
        self.assertEqual(data["technology"]["vectorDb"]["value"], "ChromaDB")
        self.assertEqual(data["technology"]["bm25"]["status"], "사용 중")
        self.assertEqual(
            data["dockerServices"],
            ["schat-web", "schat-chromadb", "schat-safety-evaluator"],
        )
        self.assertGreaterEqual(data["tests"]["totalFiles"], 2)
        self.assertEqual(data["tests"]["byArea"]["저장소 검사"], 2)
        self.assertEqual(data["history"][0]["date"], "2026-09-25")
        self.assertIn("Docker 상태를 먼저 확인합니다.", data["handover"]["html"])
        self.assertNotIn("secret-should-never-appear", serialized)
        self.assertNotIn("hospital-password", serialized)
        self.assertNotIn("GEMINI_API_KEY", serialized)

    def test_configuration_change_is_reflected_without_mutating_real_files(self):
        generator = load_generator()
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            make_fixture(root, model="gemini-before")
            before = generator.collect_overview(root)

            make_fixture(root, model="gemini-after")
            after = generator.collect_overview(root)

        self.assertEqual(before["technology"]["answerModel"]["value"], "gemini-before")
        self.assertEqual(after["technology"]["answerModel"]["value"], "gemini-after")

    def test_writes_stable_public_json(self):
        generator = load_generator()
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            make_fixture(root)
            output = root / "docs_view/schat-overview-data.json"

            expected = generator.write_overview_data(root, output)
            actual = json.loads(output.read_text(encoding="utf-8"))

        self.assertEqual(actual, expected)
        self.assertNotIn("absolutePath", json.dumps(actual))


if __name__ == "__main__":
    unittest.main()
