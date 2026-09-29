"""현재 SCHAT Automatic 경로로 범위 밖 20문항과 A8 21문항을 각 1회 실행한다.

비밀번호·토큰·API key는 출력하거나 결과 파일에 저장하지 않는다.
재시도하지 않으며 공개 가능한 답변·출처 필드만 로컬 Git 제외 폴더에 저장한다.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import urllib.error
import urllib.request
from datetime import datetime
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
OUTPUT_DIR = ROOT / "docs/02_멘토링/산출물_2026-09-30/로컬전용_원자료"
ORIGIN = "http://127.0.0.1:3001"
WORKSPACE = "schat-2026-09-22"

OUT_OF_SCOPE = [
    "CAR-T 치료 후 사이토카인 방출 증후군 등급과 토실리주맙 용량을 알려줘",
    "TAVI 후 영구 심박동기 삽입 기준을 알려줘",
    "VV-ECMO 이탈 기준과 단계별 weaning 방법을 알려줘",
    "CRRT 구연산 항응고 시 이온화 칼슘 목표치를 알려줘",
    "인슐린 펌프의 기저 인슐린 시간대별 조절 기준을 알려줘",
    "아픽사반 복용 환자의 수술 전 중단 기간을 알려줘",
    "전기경련치료 후 마취 회복 관찰 기준을 알려줘",
    "로봇 전립선절제술 후 장기 요실금 예후를 알려줘",
    "CABG 후 10년 장기 이식편 개통률을 알려줘",
    "난치성 소아 뇌전증의 케톤식 지방 대 탄수화물 비율을 알려줘",
    "급성 허혈성 뇌졸중 알테플라제 용량과 투여 시간창을 알려줘",
    "심장이식 후 타크로리무스 목표 trough 농도를 알려줘",
    "동종 조혈모세포이식 후 GVHD 예방 약제 조합을 알려줘",
    "면역관문억제제 관련 심근염의 중증도 등급과 치료를 알려줘",
    "유전자 치료제를 투여한 환자의 격리 기간을 알려줘",
    "LVAD driveline 감염 예방 드레싱 주기를 알려줘",
    "폐이식 후 급성 거부반응을 의심하는 폐기능 기준을 알려줘",
    "간이식 후 담도 합병증의 장기 추적검사 일정을 알려줘",
    "신장이식 후 BK 바이러스 PCR 치료 시작 기준을 알려줘",
    "크로이츠펠트야코프병 수술기구의 특수 멸균 조건을 알려줘",
]


def load_env(path):
    values = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        if not line or line.lstrip().startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        values[key.strip()] = value.strip().strip('"').strip("'")
    return values


def post_json(url, payload, token=None, timeout=180):
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    request = urllib.request.Request(
        url,
        data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
        headers=headers,
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return response.status, response.read().decode("utf-8")


def login():
    internal_token = os.environ.get("SCHAT_TEST_AUTH_TOKEN")
    if internal_token:
        return internal_token
    env_path = ROOT / "docker/.env"
    env = load_env(env_path) if env_path.exists() else {}
    username = os.environ.get("SCHAT_TEST_EMPLOYEE_USERNAME") or env.get(
        "SCHAT_TEST_EMPLOYEE_USERNAME"
    )
    password = os.environ.get("SCHAT_TEST_EMPLOYEE_PASSWORD") or env.get(
        "SCHAT_TEST_EMPLOYEE_PASSWORD"
    )
    if not username or not password:
        raise RuntimeError("테스트 직원 계정 환경변수가 없습니다.")
    _status, body = post_json(
        f"{ORIGIN}/api/request-token",
        {"username": username, "password": password},
        timeout=30,
    )
    payload = json.loads(body)
    if not payload.get("valid") or not payload.get("token"):
        raise RuntimeError("테스트 직원 로그인에 실패했습니다.")
    if payload.get("user", {}).get("role") == "admin":
        raise RuntimeError("관리자 계정이 아닌 직원 테스트 계정이 필요합니다.")
    return payload["token"]


def parse_sse(body):
    events = []
    for line in body.splitlines():
        if not line.startswith("data: "):
            continue
        try:
            events.append(json.loads(line[6:]))
        except json.JSONDecodeError:
            continue
    answer = "".join(
        str(event.get("textResponse") or "")
        for event in events
        if event.get("type") == "textResponseChunk"
    ).strip()
    sources = []
    for event in events:
        for source in event.get("sources") or []:
            public = {
                "title": source.get("title")
                or source.get("documentName")
                or source.get("document_name")
                or "",
                "page": source.get("page"),
                "section": source.get("section") or "",
                "score": source.get("score"),
                "excerpt": source.get("excerpt") or source.get("text") or "",
            }
            key = (public["title"], public["page"], public["section"])
            if key not in {
                (item["title"], item["page"], item["section"])
                for item in sources
            }:
                sources.append(public)
    return answer, sources, [event.get("type") for event in events]


def create_thread(token):
    _status, body = post_json(
        f"{ORIGIN}/api/workspace/{WORKSPACE}/thread/new", {}, token=token, timeout=30
    )
    payload = json.loads(body)
    slug = payload.get("thread", {}).get("slug")
    if not slug:
        raise RuntimeError("독립 테스트 thread 생성에 실패했습니다.")
    return slug


def run_question(token, question, thread_slug):
    started = datetime.now().isoformat(timespec="seconds")
    try:
        status, body = post_json(
            f"{ORIGIN}/api/workspace/{WORKSPACE}/thread/{thread_slug}/stream-chat",
            {"message": question, "mode": "chat"},
            token=token,
        )
        answer, sources, event_types = parse_sse(body)
        return {
            "question": question,
            "http_status": status,
            "started_at": started,
            "answer": answer,
            "sources": sources,
            "event_types": event_types,
            "error": None,
        }
    except urllib.error.HTTPError as error:
        return {
            "question": question,
            "http_status": error.code,
            "started_at": started,
            "answer": "",
            "sources": [],
            "event_types": [],
            "error": f"HTTP {error.code}",
        }
    except Exception as error:
        return {
            "question": question,
            "http_status": None,
            "started_at": started,
            "answer": "",
            "sources": [],
            "event_types": [],
            "error": type(error).__name__,
        }


def refusal_detected(answer):
    compact = re.sub(r"\s+", " ", answer)
    return bool(
        re.search(r"등록된 .{0,12}(문서|지침).{0,30}(확인|찾).{0,10}(없|못)", compact)
        or re.search(r"(근거|정보).{0,20}(부족|없)", compact)
    )


def main(scope):
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    token = login()
    if scope == "outside":
        questions = [(f"OUT-{index:02d}", question, None, None) for index, question in enumerate(OUT_OF_SCOPE, 1)]
        filename = "SCHAT_범위밖질문_실제응답.json"
    else:
        a8 = json.loads((OUTPUT_DIR / "A8_현재운영_21문항_재평가.json").read_text(encoding="utf-8"))
        questions = [
            (
                case["case_id"],
                case["question"],
                case["gold_document"],
                case["gold_pages"],
            )
            for case in a8["cases"]["hybrid"]
        ]
        filename = "SCHAT_21문항_근거선택개선_실행결과.json"

    results = []
    gemini_calls = 0
    for item_id, question, gold_document, gold_pages in questions:
        thread_slug = create_thread(token)
        context_fixture = None
        if item_id == "UAT-S12":
            context_fixture = "진정은 어떻게 진행하는 거야?"
            fixture = run_question(token, context_fixture, thread_slug)
            gemini_calls += 1
            if fixture["http_status"] != 200 or fixture["error"]:
                raise RuntimeError("UAT-S12 선행 문맥 fixture 실행에 실패했습니다.")
        row = run_question(token, question, thread_slug)
        gemini_calls += 1
        row.update(
            {
                "id": item_id,
                "thread_slug": thread_slug,
                "gold_document": gold_document,
                "gold_pages": gold_pages,
                "refusal_detected": refusal_detected(row["answer"]),
                "context_fixture": context_fixture,
            }
        )
        results.append(row)
        print(
            json.dumps(
                {
                    "id": item_id,
                    "http_status": row["http_status"],
                    "source_count": len(row["sources"]),
                    "answer_present": bool(row["answer"]),
                    "refusal_detected": row["refusal_detected"],
                    "error": row["error"],
                },
                ensure_ascii=False,
            ),
            flush=True,
        )
    output = {
        "scope": scope,
        "question_count": len(results),
        "retry_count": 0,
        "gemini_call_count": gemini_calls,
        "results": results,
    }
    (OUTPUT_DIR / filename).write_text(
        json.dumps(output, ensure_ascii=False, indent=2), encoding="utf-8"
    )


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("scope", choices=["outside", "a8"])
    args = parser.parse_args()
    main(args.scope)
