from __future__ import annotations

import argparse
import html
import importlib.util
import json
from pathlib import Path


def _load_overview_generator():
    path = Path(__file__).with_name("SCHAT_개요데이터_만들기.py")
    spec = importlib.util.spec_from_file_location("schat_overview_data", path)
    if spec is None or spec.loader is None:
        raise RuntimeError("SCHAT 개요 데이터 생성기를 불러올 수 없습니다.")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _e(value: object) -> str:
    return html.escape(str(value))


def _cards(items: list[dict]) -> str:
    return "".join(
        f'<article class="tech-card"><span>{_e(item["label"])}</span>'
        f'<strong>{_e(item["value"])}</strong><small>{_e(item["status"])}</small></article>'
        for item in items
    )


def _steps(items: list[dict]) -> str:
    return "".join(
        f'<li><span>{index}</span><div><strong>{_e(item["title"])}</strong>'
        f'<p>{_e(item["description"])}</p></div></li>'
        for index, item in enumerate(items, 1)
    )


def _simple_list(items: list[str]) -> str:
    return "".join(f"<li>{_e(item)}</li>" for item in items)


def _folder_details(items: list[dict]) -> str:
    return "".join(
        f'<details class="folder"><summary><code>{_e(item["name"])}</code>'
        f'<span>{_e(item["title"])}</span></summary><p>{_e(item["description"])}</p>'
        f'<small>대표 위치: {_e(item["representative"])}</small></details>'
        for item in items
    )


def _status_column(title: str, css_class: str, items: list[str]) -> str:
    return f'<article class="status-card {css_class}"><h3>{_e(title)}</h3><ul>{_simple_list(items)}</ul></article>'


def _history(items: list[dict]) -> str:
    rows = "".join(
        f'<article class="history-item"><time>{_e(item["date"])}</time><div>'
        f'<strong>{_e(item["title"])}</strong><p>{_e(item["summary"])}</p>'
        f'<small>{_e(item["feature"])}</small></div></article>'
        for item in items
    )
    return rows or '<p class="muted">등록된 작업일지가 없습니다.</p>'


def _guide_sections(guides: list[dict]) -> str:
    # Other 05_인수인계 guides continue inside the 인수인계 section.
    return "".join(
        f'<div class="guide-block" id="guide-{index}"><h3 class="guide-title">{_e(guide["title"])}</h3>'
        f'<article class="handover">{guide["html"]}</article></div><!--/guide-->'
        for index, guide in enumerate(guides)
    )


def render_page(data: dict) -> str:
    project = data["project"]
    guides = data.get("guides", [])
    guide_sections = _guide_sections(guides)
    guide_documents = "".join(f" · {_e(g['document'])}" for g in guides)
    tech_cards = _cards(list(data["technology"].values()))
    docker_services = " · ".join(data["dockerServices"]) or "확인 필요"
    test_areas = "".join(
        f'<li><span>{_e(label)}</span><strong>{count}개</strong></li>'
        for label, count in data["tests"]["byArea"].items()
    )
    public = _load_overview_generator().public_data(data)
    embedded = json.dumps(public, ensure_ascii=False).replace("<", "\\u003c")
    return f'''<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>SCHAT 프로젝트 안내</title><style>
:root{{--navy:#102a43;--teal:#087f8c;--teal-soft:#e8f5f6;--bg:#f4f7fa;--paper:#fff;--line:#d8e2ea;--muted:#627d98;--green:#247a52;--amber:#a76500}}
*{{box-sizing:border-box}}html{{scroll-behavior:smooth}}body{{margin:0;background:var(--bg);color:var(--navy);font-family:Pretendard,"Noto Sans KR","Segoe UI",sans-serif;line-height:1.65}}
a{{color:inherit}}.layout{{display:grid;grid-template-columns:250px minmax(0,1fr);min-height:100vh}}aside{{position:sticky;top:0;height:100vh;padding:28px 20px;background:#fff;border-right:1px solid var(--line)}}
aside h1{{font-size:20px;margin:0 0 4px}}aside p,.muted{{color:var(--muted)}}nav{{display:grid;gap:5px;margin-top:28px}}nav a{{padding:9px 11px;border-radius:9px;text-decoration:none;font-size:14px}}nav a:hover{{background:var(--teal-soft);color:var(--teal)}}
main{{width:min(100% - 40px,1080px);margin:0 auto;padding:42px 0 90px}}section{{scroll-margin-top:24px;margin-top:58px}}.hero{{margin-top:0;padding:42px;border-radius:24px;background:linear-gradient(135deg,#087f8c,#102a43);color:#fff;box-shadow:0 18px 50px rgba(16,42,67,.16)}}
.eyebrow{{display:block;font-size:12px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;opacity:.78}}.hero h2{{margin:8px 0 12px;font-size:clamp(30px,5vw,48px);line-height:1.15}}.hero p{{max-width:760px;margin:8px 0;line-height:1.75}}h2{{font-size:28px;margin:0 0 8px}}.lead{{margin:0 0 22px;color:var(--muted)}}
.tech-grid{{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin-top:26px}}.tech-card{{display:grid;gap:5px;padding:18px;background:var(--paper);border:1px solid var(--line);border-radius:14px}}.tech-card span,.tech-card small{{font-size:12px;color:var(--muted)}}.tech-card strong{{font-size:17px;overflow-wrap:anywhere}}.tech-card small{{color:var(--green);font-weight:700}}
.workflow{{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;padding:0;list-style:none}}.workflow li{{display:flex;gap:11px;padding:16px;background:#fff;border:1px solid var(--line);border-radius:14px}}.workflow li>span{{display:grid;place-items:center;flex:0 0 28px;height:28px;border-radius:50%;background:var(--teal);color:#fff;font-weight:800}}.workflow strong{{font-size:14px}}.workflow p{{margin:5px 0 0;color:var(--muted);font-size:13px}}
.flow-pair,.safety-grid{{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px;margin-top:20px}}.status-grid{{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px;margin-top:20px}}.plain-card,.status-card{{padding:22px;background:#fff;border:1px solid var(--line);border-radius:16px}}.plain-card h3,.status-card h3{{margin:0 0 12px}}.plain-card li,.status-card li{{margin:7px 0}}.service-line{{margin-top:18px;padding:13px 16px;border-radius:10px;background:var(--teal-soft);font-size:14px}}
.folder-list{{display:grid;gap:10px}}details{{background:#fff;border:1px solid var(--line);border-radius:13px}}summary{{cursor:pointer;font-weight:700}}.folder summary{{display:flex;align-items:center;gap:14px;padding:16px}}.folder code{{min-width:120px;color:var(--teal);font-weight:800}}.folder p{{margin:0;padding:0 16px 8px}}.folder small{{display:block;padding:0 16px 16px;color:var(--muted)}}
.status-card h3{{font-size:17px}}.status-card.done{{border-top:4px solid var(--green)}}.status-card.working{{border-top:4px solid var(--amber)}}.status-card.next{{border-top:4px solid var(--teal)}}.status-card ul{{padding-left:20px;max-height:320px;overflow:auto}}.safety-grid .plain-card ul{{padding-left:20px}}.test-list{{list-style:none;padding:0!important}}.test-list li{{display:flex;justify-content:space-between;border-bottom:1px solid var(--line);padding:7px 0}}
.history-panel>summary{{padding:18px 20px}}.history-list{{display:grid;gap:0;padding:0 20px 20px}}.history-item{{display:grid;grid-template-columns:100px 1fr;gap:18px;padding:17px 0;border-top:1px solid var(--line)}}.history-item time{{color:var(--teal);font-size:13px;font-weight:800}}.history-item p{{margin:4px 0;color:var(--muted)}}.history-item small{{color:var(--muted)}}
.handover{{padding:28px;background:#fff;border:1px solid var(--line);border-radius:18px}}.handover h2:first-child{{display:none}}.handover h3{{margin-top:30px;border-bottom:1px solid var(--line);padding-bottom:7px}}.handover h4{{margin-top:24px}}.handover pre{{overflow:auto;padding:15px;border-radius:10px;background:#102a43;color:#eaf7f8;line-height:1.55}}.handover code{{font-family:"Cascadia Code",Consolas,monospace}}.handover li{{margin:6px 0}}.handover :not(pre)>code{{padding:1px 6px;border-radius:6px;background:var(--teal-soft);color:var(--navy);font-size:.92em;word-break:break-all}}.handover .table-wrap{{overflow-x:auto;margin:14px 0}}.handover table{{width:100%;border-collapse:collapse;font-size:14px}}.handover th,.handover td{{padding:9px 12px;border:1px solid var(--line);text-align:left;vertical-align:top}}.handover th{{background:var(--teal-soft)}}.handover blockquote{{margin:14px 0;padding:10px 16px;border-left:4px solid var(--amber);background:#fff8ec;border-radius:0 10px 10px 0}}.handover blockquote p{{margin:4px 0}}.handover hr{{border:0;border-top:1px solid var(--line);margin:26px 0}}.handover a{{color:var(--teal)}}.guide-block{{margin-top:34px}}.guide-title{{font-size:22px;margin:0 0 12px;padding-top:6px}}.footer-note{{margin-top:30px;color:var(--muted);font-size:12px}}
@media(max-width:900px){{.tech-grid,.workflow{{grid-template-columns:repeat(2,minmax(0,1fr))}}.status-grid{{grid-template-columns:1fr}}}}
@media(max-width:760px){{.layout{{display:block}}aside{{position:static;height:auto;border-right:0;border-bottom:1px solid var(--line)}}nav{{grid-template-columns:repeat(2,minmax(0,1fr));margin-top:18px}}main{{width:min(100% - 24px,1080px);padding-top:24px}}.hero{{padding:28px 22px}}section{{margin-top:42px}}.tech-grid,.workflow,.flow-pair,.status-grid,.safety-grid{{grid-template-columns:1fr}}.folder summary{{align-items:flex-start;flex-direction:column;gap:4px}}.folder code{{min-width:0}}.history-item{{grid-template-columns:1fr;gap:4px}}.handover{{padding:20px 16px}}}}
</style></head><body><div class="layout">
<aside><h1>SCHAT 안내</h1><p>비개발자도 이해할 수 있는 현재 프로젝트 설명</p><nav><a href="#overview">1. 한눈에 보기</a><a href="#flow">2. 동작 방식</a><a href="#structure">3. 프로젝트 구성</a><a href="#status">4. 상태와 안전장치</a><a href="#history">5. 변경 이력</a><a href="#handover">6. 인수인계</a></nav></aside>
<main>
<section id="overview" class="hero"><span class="eyebrow">SCHAT 한눈에 보기</span><h2>{_e(project["name"])}</h2><p>{_e(project["relationship"])}</p><p>{_e(project["audience"])}</p><p>{_e(project["purpose"])}</p></section>
<section aria-labelledby="tech-title"><h2 id="tech-title">핵심 기술 구성</h2><p class="lead">표시된 값은 실제 Compose 설정과 코드에서 확인 가능한 정보만 사용합니다.</p><div class="tech-grid">{tech_cards}</div><p class="service-line"><strong>Docker 서비스</strong> · {_e(docker_services)}</p></section>
<section id="flow"><h2>어떻게 동작하나요?</h2><p class="lead">문서를 등록한 뒤 직원이 근거와 함께 답변을 확인하기까지의 흐름입니다.</p><ol class="workflow">{_steps(data["workflow"])}</ol><div class="flow-pair"><article class="plain-card"><h3>관리자</h3><ol>{_simple_list(data["userFlows"]["administrator"])}</ol></article><article class="plain-card"><h3>직원</h3><ol>{_simple_list(data["userFlows"]["employee"])}</ol></article></div></section>
<section id="structure"><h2>프로젝트 구성</h2><p class="lead">VS Code에서 자주 보는 주요 폴더만 표시합니다. 폴더를 누르면 역할과 대표 위치가 펼쳐집니다.</p><div class="folder-list">{_folder_details(data["folders"])}</div></section>
<section id="status"><h2>현재 상태와 안전장치</h2><p class="lead">공식 현재 상태 문서와 저장소에 실제 존재하는 검사 기준입니다.</p><div class="status-grid">{_status_column("완료", "done", data["status"]["completed"])}{_status_column("진행 중", "working", data["status"]["inProgress"])}{_status_column("예정", "next", data["status"]["planned"])}</div><div class="safety-grid"><article class="plain-card"><h3>안전장치</h3><ul>{_simple_list(data["safeguards"])}</ul></article><article class="plain-card"><h3>자동 검사 파일</h3><p>현재 확인된 테스트·검사 파일은 총 <strong>{data["tests"]["totalFiles"]}개</strong>입니다.</p><ul class="test-list">{test_areas}</ul></article></div></section>
<section id="history"><h2>변경 이력</h2><p class="lead">날짜별 작업일지는 삭제하지 않고 간단한 설명으로 접어 두었습니다.</p><details class="history-panel"><summary>변경 이력 보기 · {len(data["history"])}건</summary><div class="history-list">{_history(data["history"])}</div></details></section>
<section id="handover"><h2>인수인계 안내</h2><p class="lead">새 담당자는 이 화면에서 실행, 문서 등록, 주의사항과 문제 확인 순서를 대부분 확인할 수 있습니다.</p><article class="handover">{data["handover"]["html"]}</article>{guide_sections}<p class="footer-note">공식 정본: {_e(data["handover"]["document"])}{guide_documents} · 데이터 생성일: {_e(data["generatedOn"])}</p></section>
<script type="application/json" id="schat-overview-data">{embedded}</script>
</main></div></body></html>'''


def build_docs_view(repository_root: Path, output_dir: Path) -> None:
    root = repository_root.resolve()
    if (root / "docs").resolve().parent != root:
        raise ValueError("문서 정본은 이 저장소의 docs여야 합니다.")
    output_dir.mkdir(parents=True, exist_ok=True)
    overview = _load_overview_generator()
    data = overview.write_overview_data(root, output_dir / "schat-overview-data.json")
    (output_dir / "index.html").write_text(render_page(data), encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser(description="SCHAT 프로젝트 설명 화면 생성")
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1]
    build_docs_view(root, args.output or root / "docs_view")
    print("SCHAT 개요 데이터와 설명 화면을 생성했습니다.")


if __name__ == "__main__":
    main()
