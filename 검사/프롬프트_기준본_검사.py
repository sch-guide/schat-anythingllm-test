from __future__ import annotations

import re
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
PROMPT_FILE = ROOT / "server/config/prompts/answer-system.yaml"
SYSTEM_SETTINGS = ROOT / "server/models/systemSettings.js"


class PromptBaselineTest(unittest.TestCase):
    def test_answer_prompt_baseline_has_version_and_all_official_rules(self):
        content = PROMPT_FILE.read_text(encoding="utf-8")
        self.assertIn('version: "1.0"', content)
        self.assertIn('updated_at: "2026-09-30"', content)
        self.assertIn("당신은 병원 내부 지침과 교육자료를 기반으로 답변하는 SCHAT입니다.", content)
        for number in range(1, 18):
            self.assertRegex(content, rf"(?m)^  {number}\. ")
        self.assertIn('"등록된 문서에서 확인되지 않습니다."', content)

    def test_admin_setting_remains_ahead_of_yaml_fallback(self):
        source = SYSTEM_SETTINGS.read_text(encoding="utf-8")
        self.assertRegex(
            source,
            re.compile(
                r"setting\?\.value\s*\|\|\s*this\.yamlDefaultSystemPrompt\s*\|\|\s*this\.saneDefaultSystemPrompt",
                re.S,
            ),
        )


if __name__ == "__main__":
    unittest.main()
