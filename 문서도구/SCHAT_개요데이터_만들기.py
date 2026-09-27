from __future__ import annotations

import argparse
import html
import json
import os
import re
from datetime import date
from pathlib import Path


DATE_FILE = re.compile(r"^(\d{4}-\d{2}-\d{2})_(.+)\.md$")
SECRET_WORDS = re.compile(r"(?:api[_-]?key|password|secret|token)", re.IGNORECASE)

FOLDER_CATALOG = (
    ("frontend", "직원·관리자 화면", "질문 입력, 답변, 출처와 문서 관리 화면을 담당합니다.", "src/"),
    ("server", "SCHAT 서버", "로그인, 검색, Gemini 답변, 출처 검증과 API를 담당합니다.", "utils/chats/stream.js"),
    ("collector", "문서 처리", "업로드한 PDF와 파일을 읽고 검색 가능한 단위로 처리합니다.", "processSingleFile/"),
    ("docker", "실행 환경", "SCHAT 웹과 ChromaDB 등 필요한 서비스를 함께 실행합니다.", "docker-compose.yml"),
    ("safety_evaluator", "연구용 안전검사", "현재 기본 답변 경로와 분리된 Python 안전검사 코드를 보존합니다.", "core.py"),
    ("검사", "자동 검사", "설정, 검색, 문서 화면과 실행 구성이 맞는지 확인합니다.", ""),
    ("문서도구", "문서 자동화", "공식 문서를 읽어 이 설명 화면과 개요 데이터를 만듭니다.", "문서화면_만들기.py"),
    ("docs", "공식 문서", "현재 상태와 작업일지 등 프로젝트 공식 문서를 보관합니다.", ""),
    ("04_화면디자인", "화면 디자인 안내", "로고와 다크모드 등 화면 변경 위치를 쉬운 말로 설명합니다.", "README.md"),
    ("05_인수인계", "인수인계 안내", "새 담당자가 실행 방법과 주의사항을 쉽게 확인합니다.", "SCHAT_인수인계.md"),
)


def _read(path: Path) -> str:
    try:
        return path.read_text(encoding="utf-8")
    except (OSError, UnicodeError):
        return ""


def _without_frontmatter(markdown: str) -> str:
    if not markdown.startswith("---\n"):
        return markdown
    _, separator, body = markdown[4:].partition("\n---\n")
    return body if separator else markdown


def _markdown_title(markdown: str, fallback: str) -> str:
    for line in _without_frontmatter(markdown).splitlines():
        if line.startswith("# "):
            return line[2:].strip()
    return fallback


def _first_summary(markdown: str) -> str:
    for line in _without_frontmatter(markdown).splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith(("#", "|", "```")):
            continue
        stripped = re.sub(r"^[-*\d.]+\s*", "", stripped)
        stripped = re.sub(r"\[([^]]+)]\([^)]+\)", r"\1", stripped)
        if stripped:
            return stripped[:180]
    return "자세한 내용은 변경 이력에서 확인할 수 있습니다."


def markdown_to_safe_html(markdown: str) -> str:
    result: list[str] = []
    list_kind: str | None = None
    in_code = False
    code_lines: list[str] = []

    def close_list() -> None:
        nonlocal list_kind
        if list_kind:
            result.append(f"</{list_kind}>")
            list_kind = None

    for raw in _without_frontmatter(markdown).splitlines():
        line = raw.strip()
        if line.startswith("```"):
            if in_code:
                result.append(f"<pre><code>{html.escape(chr(10).join(code_lines))}</code></pre>")
                code_lines = []
                in_code = False
            else:
                close_list()
                in_code = True
            continue
        if in_code:
            code_lines.append(raw)
            continue
        if not line:
            close_list()
            continue
        heading = re.match(r"^(#{1,4})\s+(.+)$", line)
        if heading:
            close_list()
            level = min(len(heading.group(1)) + 1, 5)
            result.append(f"<h{level}>{html.escape(heading.group(2))}</h{level}>")
            continue
        bullet = re.match(r"^[-*]\s+(.+)$", line)
        number = re.match(r"^\d+[.)]\s+(.+)$", line)
        if bullet or number:
            desired = "ul" if bullet else "ol"
            if list_kind != desired:
                close_list()
                list_kind = desired
                result.append(f"<{desired}>")
            value = (bullet or number).group(1)
            result.append(f"<li>{html.escape(value)}</li>")
            continue
        close_list()
        result.append(f"<p>{html.escape(line)}</p>")
    close_list()
    if in_code:
        result.append(f"<pre><code>{html.escape(chr(10).join(code_lines))}</code></pre>")
    return "\n".join(result)


def _compose_services(compose: str) -> list[str]:
    services: list[str] = []
    in_services = False
    for line in compose.splitlines():
        if re.match(r"^services:\s*$", line):
            in_services = True
            continue
        if in_services and line and not line.startswith(" ") and not line.startswith("#"):
            break
        match = re.match(r"^  ([A-Za-z0-9_-]+):\s*$", line) if in_services else None
        if match:
            services.append(match.group(1))
            continue
        container_name = re.match(r"^    container_name:\s*[\"']?([^\s\"']+)", line) if services else None
        if container_name:
            services[-1] = container_name.group(1)
    return services


def _compose_value(compose: str, key: str) -> str:
    match = re.search(rf"^\s+{re.escape(key)}:\s*[\"']?([^\r\n\"']+)", compose, re.MULTILINE)
    if not match:
        return "확인 필요"
    value = match.group(1).strip()
    default = re.search(r":-([^}]+)", value)
    return (default.group(1) if default else value).strip()


def _test_files(repository_root: Path) -> dict:
    areas = {
        "frontend": repository_root / "frontend",
        "server": repository_root / "server",
        "collector": repository_root / "collector",
        "Python 안전검사": repository_root / "safety_evaluator",
        "저장소 검사": repository_root / "검사",
    }
    counts: dict[str, int] = {}
    for label, base in areas.items():
        count = 0
        if base.is_dir():
            for directory, subdirectories, filenames in os.walk(base):
                subdirectories[:] = [name for name in subdirectories if name != "node_modules"]
                for filename in filenames:
                    path = Path(directory) / filename
                    name = filename.lower()
                    if label == "저장소 검사" and path.suffix.lower() in {".py", ".js", ".cjs", ".mjs"}:
                        count += 1
                    elif (
                        ".test." in name
                        or ".spec." in name
                        or name.startswith("test_")
                        or name.endswith("_test.py")
                        or ".node.test." in name
                    ):
                        count += 1
        counts[label] = count
    return {"totalFiles": sum(counts.values()), "byArea": counts}


def _section_items(markdown: str, heading: str, limit: int = 8) -> list[str]:
    body = _without_frontmatter(markdown)
    match = re.search(rf"^##\s+{re.escape(heading)}\s*$([\s\S]*?)(?=^##\s|\Z)", body, re.MULTILINE)
    if not match:
        return []
    items: list[str] = []
    for line in match.group(1).splitlines():
        stripped = line.strip()
        item = re.match(r"^(?:[-*]|\d+[.)])\s+(.+)$", stripped)
        if item:
            items.append(item.group(1)[:220])
        if len(items) >= limit:
            break
    return items


def _table_status(markdown: str, limit: int = 10) -> list[str]:
    items: list[str] = []
    for line in markdown.splitlines():
        if not line.strip().startswith("|"):
            continue
        cells = [cell.strip(" `") for cell in line.strip().strip("|").split("|")]
        if len(cells) < 2 or cells[0] in {"구분", "---"} or set(cells[0]) == {"-"}:
            continue
        items.append(f"{cells[0]}: {cells[1]}")
        if len(items) >= limit:
            break
    return items


def _status(repository_root: Path) -> dict:
    text = _read(repository_root / "docs/00_현재상태/현재_프로젝트_상태.md")
    completed = _section_items(text, "완료") or _table_status(text)
    in_progress = _section_items(text, "진행 중") or _section_items(text, "현재 주의사항", 6)
    planned = _section_items(text, "예정") or _section_items(text, "다음 확인 순서", 6)
    return {
        "completed": completed or ["현재 상태 문서에서 완료 항목을 확인해야 합니다."],
        "inProgress": in_progress or ["현재 상태 문서에서 진행 중 항목을 확인해야 합니다."],
        "planned": planned or ["현재 상태 문서에서 예정 항목을 확인해야 합니다."],
    }


def _history(repository_root: Path) -> list[dict[str, str]]:
    root = repository_root / "docs/01_작업일지"
    entries: list[dict[str, str]] = []
    if not root.is_dir():
        return entries
    for path in root.glob("*.md"):
        match = DATE_FILE.match(path.name)
        if not match:
            continue
        text = _read(path)
        title = _markdown_title(text, match.group(2).replace("_", " "))
        entries.append(
            {
                "date": match.group(1),
                "title": title,
                "summary": _first_summary(text),
                "feature": match.group(2).replace("_", " "),
                "document": f"docs/01_작업일지/{path.name}",
            }
        )
    return sorted(entries, key=lambda item: (item["date"], item["title"]), reverse=True)


def _has_bm25(repository_root: Path) -> bool:
    server = repository_root / "server"
    if not server.is_dir():
        return False
    for _directory, subdirectories, filenames in os.walk(server):
        subdirectories[:] = [name for name in subdirectories if name != "node_modules"]
        if any("bm25" in filename.lower() for filename in filenames):
            return True
    return False


def collect_overview(repository_root: Path) -> dict:
    root = repository_root.resolve()
    compose = _read(root / "docker/docker-compose.yml")
    services = _compose_services(compose)
    answer_model = _compose_value(compose, "GEMINI_LLM_MODEL_PREF")
    embedding_model = _compose_value(compose, "EMBEDDING_MODEL_PREF")
    chroma_enabled = "CHROMA_ENDPOINT" in compose or any("chroma" in item for item in services)
    bm25_enabled = _has_bm25(root)

    folders = []
    for name, title, description, representative in FOLDER_CATALOG:
        if (root / name).is_dir():
            folders.append(
                {
                    "name": name,
                    "title": title,
                    "description": description,
                    "representative": representative or "대표 파일은 상세 문서에서 확인",
                }
            )

    handover_path = root / "05_인수인계/SCHAT_인수인계.md"
    handover_markdown = _read(handover_path)
    data = {
        "schemaVersion": 1,
        "generatedOn": date.today().isoformat(),
        "project": {
            "name": "SCHAT 기능 비교 테스트",
            "relationship": "AnythingLLM을 기반으로 병원 등록 문서만 사용하는 SCHAT 검색·답변 방식을 검증하는 별도 테스트 저장소입니다.",
            "audience": "문서를 관리하는 관리자와 병원 지침을 검색하는 직원이 사용합니다.",
            "purpose": "등록된 병원 문서에서 관련 근거를 찾아 자연스러운 답변과 확인 가능한 출처를 제공하는 것이 핵심 목적입니다.",
        },
        "workflow": [
            {"title": "문서 업로드", "description": "관리자가 승인된 PDF를 등록합니다."},
            {"title": "문서 처리", "description": "문서를 검색 가능한 텍스트 단위로 나눕니다."},
            {"title": "Gemini Embedding", "description": "문장의 의미를 검색용 숫자 표현으로 바꿉니다."},
            {"title": "ChromaDB 저장", "description": "검색용 의미 정보와 문서 위치를 저장합니다."},
            {"title": "질문 입력", "description": "직원이 필요한 지침을 자연어로 질문합니다."},
            {"title": "Chroma + BM25 검색", "description": "의미와 정확한 병원 용어를 함께 확인합니다."},
            {"title": "Gemini 답변", "description": "선택된 병원 근거 안에서만 답변을 구성합니다."},
            {"title": "출처 확인", "description": "문서명, 페이지, 항목과 공개 가능한 근거 원문을 보여줍니다."},
        ],
        "folders": folders,
        "technology": {
            "answerModel": {"label": "답변 모델", "value": answer_model, "status": "사용 중" if answer_model != "확인 필요" else "확인 필요"},
            "embedding": {"label": "Embedding", "value": embedding_model, "status": "사용 중" if embedding_model != "확인 필요" else "확인 필요"},
            "vectorDb": {"label": "Vector DB", "value": "ChromaDB" if chroma_enabled else "확인 필요", "status": "사용 중" if chroma_enabled else "확인 필요"},
            "bm25": {"label": "검색 보완", "value": "BM25", "status": "사용 중" if bm25_enabled else "확인 필요"},
            "runtime": {"label": "실행 환경", "value": "Docker", "status": "구성됨" if bool(services) else "확인 필요"},
            "frontend": {"label": "화면", "value": "React + Vite", "status": "구성됨" if (root / "frontend").is_dir() else "확인 필요"},
            "backend": {"label": "서버", "value": "Node.js", "status": "구성됨" if (root / "server").is_dir() else "확인 필요"},
        },
        "dockerServices": services,
        "userFlows": {
            "administrator": ["승인 문서 등록", "색인 상태 확인", "원본 문서 관리", "직원 사용 결과 확인"],
            "employee": ["질문 입력", "근거 기반 답변 확인", "출처 확인", "필요하면 근거 원문 확인"],
        },
        "status": _status(root),
        "tests": _test_files(root),
        "safeguards": [
            "근거가 없으면 Gemini를 호출하지 않고 답변을 중단합니다.",
            "등록된 SCHAT 문서 밖의 일반 지식과 외부 웹검색을 사용하지 않습니다.",
            "structured JSON과 허용된 출처 번호를 서버에서 검증합니다.",
            "내부 ID, metadata, 경로와 SVG를 직원 화면에 노출하지 않습니다.",
            "Docker healthcheck, production build와 git diff 검사를 사용합니다.",
        ],
        "history": _history(root),
        "handover": {
            "title": _markdown_title(handover_markdown, "SCHAT 인수인계 안내"),
            "html": markdown_to_safe_html(handover_markdown) if handover_markdown else "<p>인수인계 문서를 확인해야 합니다.</p>",
            "document": "05_인수인계/SCHAT_인수인계.md",
        },
    }
    serialized = json.dumps(data, ensure_ascii=False)
    if SECRET_WORDS.search(serialized):
        # Labels such as "API key" are useful safety prose, but secret-shaped
        # fields must never be collected. This check targets assignment forms.
        if re.search(r"(?:api[_-]?key|password|secret|token)\s*[=:]", serialized, re.IGNORECASE):
            raise ValueError("공개 개요 데이터에 비밀정보 형태의 값이 포함되었습니다.")
    return data


def write_overview_data(repository_root: Path, output_path: Path) -> dict:
    data = collect_overview(repository_root)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return data


def main() -> None:
    parser = argparse.ArgumentParser(description="SCHAT 비개발자용 개요 JSON 생성")
    parser.add_argument("--root", type=Path)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    root = (args.root or Path(__file__).resolve().parents[1]).resolve()
    output = args.output or root / "docs_view/schat-overview-data.json"
    write_overview_data(root, output)
    print(f"SCHAT 개요 데이터를 생성했습니다: {output}")


if __name__ == "__main__":
    main()
