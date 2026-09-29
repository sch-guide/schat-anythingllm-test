"""컨테이너 내부 1회성 검증에 쓸 질문 목록만 준비한다."""

import importlib.util
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
STORAGE = ROOT / "server/storage"

def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module

live = load("live", ROOT / "tools/schat_1_0_live_review.py")
a8 = json.loads((ROOT / "docs/02_멘토링/산출물_2026-09-30/로컬전용_원자료/A8_현재운영_21문항_재평가.json").read_text(encoding="utf-8"))

jobs = {
    "outside": [{"id": f"OUT-{i:02d}", "question": q, "gold_document": None, "gold_pages": None} for i, q in enumerate(live.OUT_OF_SCOPE, 1)],
    "a8": [{"id": c["case_id"], "question": c["question"], "gold_document": c["gold_document"], "gold_pages": c["gold_pages"]} for c in a8["cases"]["hybrid"]],
}
for scope, questions in jobs.items():
    path = STORAGE / f"schat_1_0_{scope}_job.json"
    path.write_text(json.dumps({"scope": scope, "questions": questions}, ensure_ascii=False, indent=2), encoding="utf-8")
    print(path.name, len(questions))
