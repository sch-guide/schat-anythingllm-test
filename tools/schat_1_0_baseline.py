"""SCHAT 1.0 후속 작업 전후의 비밀값 없는 기준선을 기록한다."""

from __future__ import annotations

import argparse
import hashlib
import json
import sqlite3
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_OUTPUT = (
    ROOT
    / "docs/02_멘토링/산출물_2026-09-30/로컬전용_원자료"
    / "SCHAT_1.0_변경전_기준선.json"
)


def scalar(connection, table):
    return connection.execute(f'SELECT count(*) FROM "{table}"').fetchone()[0]


def main(output_path):
    db_path = ROOT / "server/storage/anythingllm.db"
    connection = sqlite3.connect(db_path)
    tables = [
        "users",
        "workspaces",
        "workspace_documents",
        "document_vectors",
        "workspace_chats",
        "schat_issue_reports",
        "schat_faq_items",
        "schat_quiz_sets",
        "schat_synonym_groups",
    ]
    counts = {table: scalar(connection, table) for table in tables}
    row = connection.execute(
        "SELECT value FROM system_settings WHERE label = ?",
        ("default_system_prompt",),
    ).fetchone()
    prompt = (row[0] if row else "") or ""
    connection.close()

    a8_path = (
        ROOT
        / "docs/02_멘토링/산출물_2026-09-30/로컬전용_원자료"
        / "A8_현재운영_21문항_재평가.json"
    )
    a8 = json.loads(a8_path.read_text(encoding="utf-8"))
    snapshot = {
        "database_counts": counts,
        "default_prompt": {
            "length": len(prompt),
            "sha256": hashlib.sha256(prompt.encode("utf-8")).hexdigest(),
        },
        "body_vector_count": a8["corpus"]["body_vector_count"],
        "a8_metrics": a8["aggregate_metrics"],
        "a8_top10": {
            engine: [
                {
                    "case_id": case["case_id"],
                    "results": [
                        {
                            "rank": row["rank"],
                            "id": row["id"],
                            "document": row["document"],
                            "page": row["page"],
                            "score": row["score"],
                        }
                        for row in case["rankings"]
                    ],
                }
                for case in cases
            ]
            for engine, cases in a8["cases"].items()
        },
    }
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(
        json.dumps(snapshot, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(
        json.dumps(
            {
                "database_counts": counts,
                "default_prompt_length": len(prompt),
                "body_vector_count": snapshot["body_vector_count"],
                "a8_metrics": snapshot["a8_metrics"],
            },
            ensure_ascii=False,
        )
    )


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    args = parser.parse_args()
    main(args.output)
