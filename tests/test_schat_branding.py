from pathlib import Path
import re
import unittest


ROOT = Path(__file__).resolve().parents[1]
FRONTEND = ROOT / "frontend"


class SchatBrandingContractTest(unittest.TestCase):
    def test_default_title_and_brand_assets_are_schat(self):
        index_html = (FRONTEND / "index.html").read_text(encoding="utf-8")
        logo_context = (FRONTEND / "src" / "LogoContext.jsx").read_text(
            encoding="utf-8"
        )
        meta_generator = (
            ROOT / "server" / "utils" / "boot" / "MetaGenerator.js"
        ).read_text(encoding="utf-8")

        self.assertIn("병원 실무지침 AI", index_html)
        self.assertIn("schat-logo.svg", logo_context)
        self.assertIn("schat-login.svg", logo_context)
        self.assertIn('name: "병원 실무지침 AI"', meta_generator)
        self.assertNotIn("AnythingLLM | Your personal LLM", meta_generator)
        self.assertNotIn("anythingllm.com", meta_generator.lower())
        self.assertNotIn("mintplex-labs/anything-llm", meta_generator.lower())

    def test_schat_theme_tokens_exist(self):
        theme = (FRONTEND / "src" / "schat-brand.css").read_text(encoding="utf-8")

        self.assertIn("--schat-accent: #007e87", theme.lower())
        self.assertIn("--schat-navy: #152b40", theme.lower())
        self.assertIn("--schat-page: #f7f9fb", theme.lower())

    def test_login_is_employee_facing(self):
        login_shell = (
            FRONTEND
            / "src"
            / "components"
            / "Modals"
            / "Password"
            / "index.jsx"
        ).read_text(encoding="utf-8")

        self.assertIn("직원 전용", login_shell)
        self.assertIn("순천향대학교 부속 천안병원", login_shell)

    def test_original_product_name_is_not_present_in_web_source(self):
        visible_name = re.compile(r"Anything\s*LLM")
        offenders = []
        paths = [FRONTEND / "index.html"]
        paths.extend(
            path
            for path in (FRONTEND / "src").rglob("*")
            if path.suffix in {".js", ".jsx", ".ts", ".tsx", ".html"}
        )

        for path in paths:
            text = path.read_text(encoding="utf-8", errors="ignore")
            if visible_name.search(text):
                offenders.append(str(path.relative_to(ROOT)))

        self.assertEqual([], offenders, "원래 제품명이 남은 파일: " + ", ".join(offenders))

    def test_old_product_logo_is_not_used_by_web_source(self):
        offenders = []
        for path in (FRONTEND / "src").rglob("*"):
            if path.suffix not in {".js", ".jsx", ".ts", ".tsx"}:
                continue
            if "media/logo/anything-llm" in path.read_text(
                encoding="utf-8", errors="ignore"
            ):
                offenders.append(str(path.relative_to(ROOT)))

        self.assertEqual([], offenders, "기존 로고를 쓰는 파일: " + ", ".join(offenders))


if __name__ == "__main__":
    unittest.main()
