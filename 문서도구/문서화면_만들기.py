from __future__ import annotations

import argparse
import html
import re
import importlib.util
import json
import shutil
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


def _version_cards(items: list[dict]) -> str:
    return "".join(
        f'<article class="tech-card"><span>{_e(item["version"])}</span>'
        f'<strong>{_e(item["title"])}</strong><small>{_e(item["description"])}</small></article>'
        for item in items
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


# Each 05_인수인계 guide is shown in the menu it belongs to; the deployment
# guide (and any other operations guide) stays inside 인수인계.
GUIDE_MENUS = (("검색_점수", "how"), ("개발_복기", "journey"))


def _guide_menu(guide: dict) -> str:
    document = guide.get("document", "")
    for marker, menu in GUIDE_MENUS:
        if marker in document:
            return menu
    return "ops"


def _guide_sections(guides: list[dict], menu: str) -> str:
    return "".join(
        f'<details class="doc-panel guide-block" id="guide-{index}"><summary>{_e(guide["title"])}'
        f'<small>{_e(guide.get("summary", "").lstrip("> "))}</small></summary>'
        f'<article class="handover">{guide["html"]}</article></details><!--/guide-->'
        for index, guide in enumerate(guides)
        if _guide_menu(guide) == menu
    )


STATUS_BADGES = {
    "✅": ("done", "완료"),
    "🔶": ("working", "진행 중"),
    "❌": ("todo", "아직"),
    "❓": ("decide", "팀 결정 필요"),
    "➖": ("na", "해당 없음"),
}


def _status_badges(fragment: str) -> str:
    """Status icons become colored badges; a table cell holding only an icon
    also shows its meaning in words."""
    cells: list[str] = []

    def keep(badge: str) -> str:
        cells.append(badge)
        return f"{len(cells) - 1}"

    for icon, (css, label) in STATUS_BADGES.items():
        fragment = fragment.replace(
            f"<td>{icon}</td>",
            "<td>" + keep(f'<span class="status-badge status-{css}">{icon} {label}</span>') + "</td>",
        )
    for icon, (css, _label) in STATUS_BADGES.items():
        fragment = fragment.replace(
            icon, f'<span class="status-badge status-{css}">{icon}</span>'
        )
    return re.sub("(\d+)", lambda m: cells[int(m.group(1))], fragment)


def _mentoring_anchor(record: dict, index: int) -> str:
    return _e(record.get("anchor") or f"mentoring-{index}")


def _mentoring_sections(records: list[dict]) -> str:
    if not records:
        return '<p class="muted">등록된 멘토링 기록이 없습니다.</p>'
    overviews = [record for record in records if "한눈에_보기" in record.get("document", "")]
    evidence = [record for record in records if record not in overviews]
    primary = "".join(
        f'<div class="guide-block" id="{_mentoring_anchor(record, index)}"><h3 class="guide-title">{_e(record["title"])}</h3>'
        f'<article class="handover">{_status_badges(record["html"])}</article></div><!--/mentoring-->'
        for index, record in enumerate(overviews)
    )
    if not evidence:
        return primary
    details = "".join(
        f'<div class="mentoring-evidence-item" id="{_mentoring_anchor(record, index + len(overviews))}"><h3 class="guide-title">{_e(record["title"])}</h3>'
        f'<article class="handover">{_status_badges(record["html"])}</article></div>'
        for index, record in enumerate(evidence)
    )
    return (
        primary
        + '<details class="mentoring-evidence"><summary>▶ 자세한 근거 보기</summary>'
        + details
        + "</details>"
    )


def _mentoring_diagrams() -> str:
    diagrams = (
        ("시스템 아키텍처", "브라우저부터 SCHAT, 검색과 Gemini까지의 연결", "시스템_아키텍처.svg"),
        ("질문 처리 플로우", "질문 정리부터 답변·출처·체크리스트까지의 흐름", "질문_처리_흐름.svg"),
        ("문서 등록 DFD", "PDF가 글·그림·조각·벡터로 저장되는 과정", "문서_등록_DFD.svg"),
        ("저장 구조 ERD", "사용자·문서·조각·체크리스트·퀴즈·동의어의 관계", "저장_구조_ERD.svg"),
    )
    cards = "".join(
        '<figure class="mentoring-diagram">'
        f'<figcaption><strong>{_e(title)}</strong><span>{_e(description)}</span></figcaption>'
        f'<img src="assets/mentoring/{_e(filename)}" alt="{_e(title)}" loading="lazy">'
        "</figure>"
        for title, description, filename in diagrams
    )
    merged = (
        '<figure class="mentoring-diagram wide" id="merged-architecture">'
        "<figcaption><strong>통합 아키텍처 (Hybrid 검색 + AnythingLLM 임베딩)</strong>"
        "<span>버전 2에서 검증한 Hybrid 검색과 AnythingLLM의 임베딩·채팅 구조가 현재 SCHAT에서 합쳐진 위치"
        f' · <a href="assets/mentoring/{_e(MERGED_ARCHITECTURE)}" target="_blank" rel="noopener">새 창에서 크게 보기</a></span></figcaption>'
        f'<iframe src="assets/mentoring/{_e(MERGED_ARCHITECTURE)}" title="SCHAT 통합 아키텍처" loading="lazy"></iframe>'
        "</figure>"
    )
    return '<div class="mentoring-diagrams">' + merged + cards + "</div>"


MERGED_ARCHITECTURE = "시스템_아키텍처_통합구조.html"


MENUS = (
    ("intro", "1. 프로젝트 소개", "SCHAT이 무엇이고 지금 어떤 버전인지"),
    ("how", "2. 동작 방식", "질문이 답변과 출처가 되기까지"),
    ("state", "3. 기능과 상태", "지금 쓸 수 있는 기능과 검증 결과"),
    ("journey", "4. 개발 과정", "버전 1부터 지금까지의 변화"),
    ("ops", "5. 운영·인수인계", "서버·백업·안전장치와 멘토링"),
)


def _named_cards(items: list[dict]) -> str:
    return "".join(
        f'<article class="info-card"><strong>{_e(item["name"])}</strong><p>{_e(item["description"])}</p></article>'
        for item in items
    )


def _subnav(items: list[tuple[str, str]]) -> str:
    links = "".join(f'<a href="#{anchor}">{_e(label)}</a>' for anchor, label in items)
    return f'<nav class="subnav" aria-label="이 메뉴 안의 내용">{links}</nav>'


def _pager(menu: str) -> str:
    ids = [item[0] for item in MENUS]
    index = ids.index(menu)
    previous = (
        f'<a href="#{MENUS[index - 1][0]}">← {_e(MENUS[index - 1][1])}</a>'
        if index > 0
        else "<span></span>"
    )
    following = (
        f'<a href="#{MENUS[index + 1][0]}">{_e(MENUS[index + 1][1])} →</a>'
        if index < len(MENUS) - 1
        else "<span></span>"
    )
    return f'<div class="pager">{previous}{following}</div>'


def _page(menu: str, lead: str, subnav: list[tuple[str, str]], body: str) -> str:
    title = next(item[1] for item in MENUS if item[0] == menu)
    return (
        f'<div class="page" id="{menu}" role="region" aria-labelledby="{menu}-title">'
        f'<header class="page-head"><h2 id="{menu}-title">{_e(title)}</h2><p class="lead">{_e(lead)}</p>'
        f"{_subnav(subnav)}</header>{body}{_pager(menu)}</div>"
    )


def _panel(summary: str, html_body: str, open_: bool = False) -> str:
    if not html_body:
        return ""
    attribute = " open" if open_ else ""
    return (
        f'<details class="doc-panel"{attribute}><summary>{_e(summary)}</summary>'
        f'<article class="handover">{html_body}</article></details>'
    )


# Shows one menu at a time (the others stay in the page for search and print).
# Without JavaScript every menu is simply shown one after another.
PAGE_SCRIPT = """(function(){var d=document,root=d.documentElement;root.classList.add('js');
var pages=[].slice.call(d.querySelectorAll('.page')),links=[].slice.call(d.querySelectorAll('#site-nav a')),
toggle=d.querySelector('.menu-toggle'),nav=d.getElementById('site-nav');
function pageOf(el){while(el&&!(el.classList&&el.classList.contains('page')))el=el.parentElement;return el}
function show(hash,scroll){var id=decodeURIComponent((hash||'').replace(/^#/,'')),target=id?d.getElementById(id):null,page=pageOf(target)||pages[0];
pages.forEach(function(p){p.hidden=p!==page});
links.forEach(function(a){var on=a.getAttribute('href')==='#'+page.id;a.classList.toggle('active',on);if(on){a.setAttribute('aria-current','page');if(toggle)toggle.querySelector('span').textContent=a.querySelector('strong').textContent}else a.removeAttribute('aria-current')});
for(var el=target;el;el=el.parentElement){if(el.tagName==='DETAILS')el.open=true}
if(toggle){toggle.setAttribute('aria-expanded','false');nav.classList.remove('open')}
if(scroll){if(target&&target!==page)target.scrollIntoView();else window.scrollTo(0,0)}}
window.addEventListener('hashchange',function(){show(location.hash,true)});
if(toggle)toggle.addEventListener('click',function(){var open=nav.classList.toggle('open');toggle.setAttribute('aria-expanded',String(open))});
show(location.hash,!!location.hash)})();"""


def render_page(data: dict) -> str:
    project = data["project"]
    guides = data.get("guides", [])
    state = data.get("stateDocument", {})
    version_doc = data.get("versionDocument", {})
    tech_cards = _cards(list(data["technology"].values()))
    docker_services = " · ".join(data["dockerServices"]) or "확인 필요"
    test_areas = "".join(
        f"<li><span>{_e(label)}</span><strong>{count}개</strong></li>"
        for label, count in data["tests"]["byArea"].items()
    )
    stages = data["versionSystem"]["stages"]
    current_version = data["versionSystem"]["current"]
    current_stage = next(
        (stage for stage in stages if stage["version"] in current_version),
        stages[0] if stages else {},
    )
    next_stage = next((stage for stage in stages if stage["version"] == "버전 4"), None)
    features = state.get("features", [])
    guide_documents = "".join(f" · {_e(g['document'])}" for g in guides)
    public = _load_overview_generator().public_data(data)
    embedded = json.dumps(public, ensure_ascii=False).replace("<", "\\u003c")
    menu_links = "".join(
        f'<a href="#{menu}"><strong>{_e(title)}</strong><small>{_e(hint)}</small></a>'
        for menu, title, hint in MENUS
    )
    reading_order = "".join(
        f'<li><a href="#{menu}"><strong>{_e(title)}</strong><span>{_e(hint)}</span></a></li>'
        for menu, title, hint in MENUS
    )
    feature_chips = "".join(f"<li>{_e(item['name'])}</li>" for item in features)
    status_lists = (
        '<details class="doc-panel"><summary>현재 상태 문서의 완료·진행 중·예정 목록</summary><div class="status-grid">'
        + _status_column("완료", "done", data["status"]["completed"])
        + _status_column("진행 중", "working", data["status"]["inProgress"])
        + _status_column("예정 · 버전 4 이후 개선사항", "next", data["status"]["planned"])
        + "</div></details>"
    )
    next_steps = state.get("nextSteps") or data["status"]["planned"]
    next_intro = (
        f'<p><strong>{_e(next_stage["version"])} · {_e(next_stage["title"])}</strong> — {_e(next_stage["description"])}</p>'
        if next_stage
        else ""
    )
    safety_card = (
        f'<article class="plain-card handover-lite">{state["safetyHtml"]}</article>'
        if state.get("safetyHtml")
        else ""
    )
    lessons = _guide_sections(guides, "journey") or '<p class="muted">복기 문서가 없습니다.</p>'
    verification = (
        f'<article class="handover">{_status_badges(state["verificationHtml"])}</article>'
        if state.get("verificationHtml")
        else ""
    )

    intro = _page(
        "intro",
        "처음 보는 분은 이 메뉴부터 읽고, 아래 순서대로 다음 메뉴로 넘어가면 됩니다.",
        [
            ("overview", "한눈에 보기"),
            ("reading-order", "읽는 순서"),
            ("current-version", "현재 버전"),
            ("key-features", "핵심 기능"),
        ],
        f'<section id="overview" class="hero"><span class="eyebrow">SCHAT 한눈에 보기</span>'
        f'<h2>{_e(project["name"])}</h2><p>{_e(project["relationship"])}</p><p>{_e(project["audience"])}</p>'
        f'<p>{_e(project["purpose"])}</p><p class="hero-version">현재 버전 · <strong>{_e(current_version)}</strong></p></section>'
        f'<section id="reading-order"><h3>처음 보는 분은 이 순서로 보세요</h3><ol class="reading-order">{reading_order}</ol></section>'
        f'<section id="current-version"><h3>현재 버전</h3><article class="plain-card">'
        f'<strong class="card-title">{_e(current_version)} · {_e(current_stage.get("title", ""))}</strong>'
        f'<p>{_e(current_stage.get("description", ""))}</p>'
        f'<p class="muted">버전 1부터 4까지의 흐름은 <a href="#versions">4. 개발 과정 › 버전 체계</a>에서 볼 수 있습니다.</p></article></section>'
        f'<section id="key-features"><h3>핵심 기능</h3><ul class="chips">{feature_chips}</ul>'
        f'<p class="muted">기능별 설명은 <a href="#features">3. 기능과 상태 › 주요 기능</a>에 있습니다.</p></section>',
    )

    how = _page(
        "how",
        "문서를 등록한 뒤 직원이 근거와 함께 답변을 확인하기까지의 흐름입니다.",
        [
            ("flow", "질문 처리 흐름"),
            ("search-methods", "검색 방식"),
            ("tech", "기술 구성"),
            ("relationship", "AnythingLLM과의 관계"),
            ("diagrams", "구조도"),
        ],
        f'<section id="flow"><h3>어떻게 동작하나요?</h3><ol class="workflow">{_steps(data["workflow"])}</ol>'
        f'<div class="flow-pair"><article class="plain-card"><h4>관리자</h4><ol>{_simple_list(data["userFlows"]["administrator"])}</ol></article>'
        f'<article class="plain-card"><h4>직원</h4><ol>{_simple_list(data["userFlows"]["employee"])}</ol></article></div></section>'
        f'<section id="search-methods"><h3>검색 방식 쉽게 보기 (RAG · BM25 · Vector · Hybrid)</h3>'
        f'<p class="muted">질문과 관련된 지침서 조각을 먼저 찾고(RAG), 그 근거 안에서만 답변합니다.</p>'
        f'<div class="card-grid">{_named_cards(state.get("searchMethods", []))}</div>'
        f'{_panel("문서를 등록하면 무엇이 저장되나요?", state.get("registrationHtml", ""))}'
        f'{_guide_sections(guides, "how")}</section>'
        f'<section id="tech" aria-labelledby="tech-title"><h3 id="tech-title">핵심 기술 구성</h3>'
        f'<p class="muted">표시된 값은 실제 Compose 설정과 코드에서 확인 가능한 정보만 사용합니다.</p>'
        f'<div class="tech-grid">{tech_cards}</div><p class="service-line"><strong>Docker 서비스</strong> · {_e(docker_services)}</p></section>'
        f'<section id="relationship"><h3>AnythingLLM과 SCHAT의 관계</h3><article class="plain-card">'
        f'<p>{_e(project["relationship"])}</p><p>{_e(current_stage.get("description", ""))}</p></article></section>'
        f'<section id="diagrams"><h3>구조도</h3>{_mentoring_diagrams()}</section>',
    )

    state_page = _page(
        "state",
        "지금 직원과 관리자가 쓸 수 있는 기능과, 현재 버전의 검증 결과입니다.",
        [("features", "주요 기능"), ("status", "현재 상태"), ("tests", "자동 검사")],
        f'<section id="features"><h3>주요 기능</h3><div class="card-grid">{_named_cards(features)}</div></section>'
        f'<section id="status"><h3>현재 상태와 검증 결과</h3>{verification}{status_lists}'
        f'{_panel("개발·테스트·운영 환경", state.get("environmentsHtml", ""))}</section>'
        f'<section id="tests"><h3>자동 검사</h3><article class="plain-card"><p>현재 확인된 테스트·검사 파일은 총 '
        f'<strong>{data["tests"]["totalFiles"]}개</strong>입니다.</p><ul class="test-list">{test_areas}</ul></article></section>',
    )

    journey = _page(
        "journey",
        "SCHAT이 버전 1부터 지금까지 어떻게 바뀌었는지, 무엇을 시도하고 결정했는지 봅니다.",
        [("versions", "버전 체계"), ("history", "변경 이력"), ("lessons", "시행착오와 의사결정")],
        f'<section id="versions"><h3>SCHAT 버전 체계</h3><p class="muted">현재 운영 버전은 <strong>{_e(current_version)}</strong>임. '
        f"버전 번호는 개발 구조가 크게 달라진 단계를 기준으로 구분함.</p>"
        f'<div class="tech-grid">{_version_cards(stages)}</div>'
        f'{_panel("버전 체계 자세히 보기", version_doc.get("html", ""))}'
        f'<p class="service-line"><strong>공식 기준 문서</strong> · {_e(data["versionSystem"]["document"])}</p></section>'
        f'<section id="history"><h3>변경 이력</h3><p class="muted">날짜별 작업일지는 삭제하지 않고 간단한 설명으로 접어 두었습니다.</p>'
        f'<details class="history-panel"><summary>변경 이력 보기 · {len(data["history"])}건</summary>'
        f'<div class="history-list">{_history(data["history"])}</div></details></section>'
        f'<section id="lessons"><h3>검색 성능 개선과 시행착오</h3>'
        f'<p class="muted">문제를 만났을 때 어떤 원인을 의심했고 무엇을 결정했는지 남긴 복기 문서입니다.</p>'
        f"{lessons}</section>",
    )

    ops = _page(
        "ops",
        "서버를 운영하고 다음 담당자에게 넘길 때 필요한 내용입니다.",
        [
            ("handover", "인수인계"),
            ("safety", "백업과 안전장치"),
            ("structure", "주요 파일 위치"),
            ("mentoring", "멘토링 결과"),
            ("next", "다음 개선사항"),
        ],
        f'<section id="handover"><h3>인수인계 안내</h3><p class="muted">새 담당자는 실행, 문서 등록, 주의사항과 문제 확인 순서를 여기서 확인합니다. '
        f"제목을 누르면 펼쳐지거나 접힙니다.</p>"
        f'{_panel(data["handover"]["title"], data["handover"]["html"], open_=True)}'
        f'{_guide_sections(guides, "ops")}'
        f'<p class="service-line"><strong>배포 구조</strong> · Google Cloud 서버의 Docker에서 {_e(docker_services)}를 실행함.</p></section>'
        f'<section id="safety"><h3>백업과 안전장치</h3><div class="safety-grid"><article class="plain-card"><h4>안전장치</h4>'
        f'<ul>{_simple_list(data["safeguards"])}</ul></article>{safety_card}</div></section>'
        f'<section id="structure"><h3>프로젝트 구성 · 주요 파일 위치</h3>'
        f'<p class="muted">VS Code에서 자주 보는 주요 폴더만 표시합니다. 폴더를 누르면 역할과 대표 위치가 펼쳐집니다.</p>'
        f'<div class="folder-list">{_folder_details(data["folders"])}</div></section>'
        f'<section id="mentoring"><h3>멘토링 결과</h3><p class="muted">멘토 조언과 그 조언을 어디까지 반영했는지 근거와 함께 정리합니다. 새 기록이 위에 옵니다.</p>'
        f'{_mentoring_sections(data.get("mentoring", []))}<p class="footer-note">공식 정본: docs/02_멘토링</p></section>'
        f'<section id="next"><h3>다음 개선사항</h3><article class="plain-card">{next_intro}<ul>{_simple_list(next_steps)}</ul></article>'
        f'<p class="footer-note">공식 정본: {_e(data["handover"]["document"])}{guide_documents} · 최종 업데이트(데이터 생성일): {_e(data["generatedOn"])}</p></section>',
    )

    return (
        '<!doctype html>\n<html lang="ko"><head><meta charset="utf-8">'
        '<meta name="viewport" content="width=device-width, initial-scale=1">\n'
        "<title>SCHAT 프로젝트 안내</title><style>\n"
        + PAGE_STYLE
        + '</style></head><body><div class="layout">\n'
        f'<aside><h1>SCHAT 안내</h1><small class="updated">최종 업데이트: {_e(data["generatedOn"])}</small><p>처음이면 1번부터 차례로 보세요.</p>'
        '<button type="button" class="menu-toggle" aria-expanded="false" aria-controls="site-nav">'
        "<span>1. 프로젝트 소개</span><small>메뉴 ▾</small></button>"
        f'<nav id="site-nav" aria-label="문서 메뉴">{menu_links}</nav></aside>\n<main>\n'
        + "\n".join((intro, how, state_page, journey, ops))
        + f'\n<script type="application/json" id="schat-overview-data">{embedded}</script>\n'
        + f"<script>{PAGE_SCRIPT}</script>\n</main></div></body></html>"
    )


PAGE_STYLE = """:root{--navy:#102a43;--teal:#087f8c;--teal-soft:#e8f5f6;--bg:#f4f7fa;--paper:#fff;--line:#d8e2ea;--muted:#627d98;--green:#247a52;--amber:#a76500}
*{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;background:var(--bg);color:var(--navy);font-family:Pretendard,"Noto Sans KR","Segoe UI",sans-serif;line-height:1.65}
a{color:inherit}.layout{display:grid;grid-template-columns:260px minmax(0,1fr);min-height:100vh}aside{position:sticky;top:0;height:100vh;overflow:auto;padding:28px 18px;background:#fff;border-right:1px solid var(--line)}
aside h1{font-size:20px;margin:0 0 4px}aside .updated{display:inline-block;margin:2px 0 6px;padding:2px 9px;border-radius:999px;background:var(--teal-soft);color:var(--teal);font-size:12px;font-weight:700}aside p,.muted{color:var(--muted)}#site-nav{display:grid;gap:6px;margin-top:26px}#site-nav a{display:grid;gap:2px;padding:11px 12px;border-radius:11px;text-decoration:none;border:1px solid transparent}#site-nav a strong{font-size:15px}#site-nav a small{font-size:12px;color:var(--muted)}#site-nav a:hover{background:var(--teal-soft);color:var(--teal)}#site-nav a.active{background:var(--teal);border-color:var(--teal);color:#fff}#site-nav a.active small{color:#d9f1f3}.menu-toggle{display:none}
main{width:min(100% - 40px,1080px);margin:0 auto;padding:36px 0 90px}.page+.page{margin-top:70px;padding-top:40px;border-top:1px solid var(--line)}.js .page+.page{margin-top:0;padding-top:0;border-top:0}.page-head h2{font-size:30px;margin:0 0 6px}section{scroll-margin-top:24px;margin-top:40px}section h3{font-size:21px;margin:0 0 10px}section h4{margin:0 0 10px}.lead{margin:0 0 14px;color:var(--muted)}
.subnav{display:flex;flex-wrap:wrap;gap:8px;margin:6px 0 4px}.subnav a{padding:5px 12px;border:1px solid var(--line);border-radius:999px;background:#fff;font-size:13px;text-decoration:none;color:var(--teal)}.subnav a:hover{background:var(--teal-soft)}
.hero{margin-top:24px;padding:40px;border-radius:24px;background:linear-gradient(135deg,#087f8c,#102a43);color:#fff;box-shadow:0 18px 50px rgba(16,42,67,.16)}.eyebrow{display:block;font-size:12px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;opacity:.78}.hero h2{margin:8px 0 12px;font-size:clamp(28px,5vw,44px);line-height:1.15}.hero p{max-width:760px;margin:8px 0;line-height:1.75}.hero .hero-version{display:inline-block;margin-top:14px;padding:6px 14px;border-radius:999px;background:rgba(255,255,255,.16)}
.reading-order{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:10px;padding:0;list-style:none}.reading-order a{display:grid;gap:4px;height:100%;padding:16px;background:#fff;border:1px solid var(--line);border-radius:14px;text-decoration:none}.reading-order a:hover{border-color:var(--teal)}.reading-order span{font-size:13px;color:var(--muted)}
.chips{display:flex;flex-wrap:wrap;gap:8px;padding:0;list-style:none}.chips li{padding:7px 14px;border-radius:999px;background:var(--teal-soft);color:var(--teal);font-weight:700;font-size:14px}
.card-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;margin:14px 0}.info-card{padding:16px 18px;background:#fff;border:1px solid var(--line);border-radius:14px}.info-card p{margin:6px 0 0;color:var(--muted);font-size:14px}.card-title{display:block;font-size:17px;margin-bottom:6px}
.tech-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin-top:16px}.tech-card{display:grid;gap:5px;padding:18px;background:var(--paper);border:1px solid var(--line);border-radius:14px}.tech-card span,.tech-card small{font-size:12px;color:var(--muted)}.tech-card strong{font-size:17px;overflow-wrap:anywhere}.tech-card small{color:var(--green);font-weight:700}
.workflow{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;padding:0;list-style:none}.workflow li{display:flex;gap:11px;padding:16px;background:#fff;border:1px solid var(--line);border-radius:14px}.workflow li>span{display:grid;place-items:center;flex:0 0 28px;height:28px;border-radius:50%;background:var(--teal);color:#fff;font-weight:800}.workflow strong{font-size:14px}.workflow p{margin:5px 0 0;color:var(--muted);font-size:13px}
.flow-pair,.safety-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px;margin-top:16px}.status-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px;padding:16px}.plain-card,.status-card{padding:22px;background:#fff;border:1px solid var(--line);border-radius:16px}.plain-card h3,.status-card h3{margin:0 0 12px}.plain-card li,.status-card li{margin:7px 0}.plain-card>p:first-child{margin-top:0}.service-line{margin-top:16px;padding:13px 16px;border-radius:10px;background:var(--teal-soft);font-size:14px}
.folder-list{display:grid;gap:10px}details{background:#fff;border:1px solid var(--line);border-radius:13px}summary{cursor:pointer;font-weight:700}.folder summary{display:flex;align-items:center;gap:14px;padding:16px}.folder code{min-width:120px;color:var(--teal);font-weight:800}.folder p{margin:0;padding:0 16px 8px}.folder small{display:block;padding:0 16px 16px;color:var(--muted)}
.doc-panel{margin-top:14px}.doc-panel>summary{display:grid;gap:3px;padding:16px 20px;color:var(--navy)}.doc-panel>summary small{font-weight:400;color:var(--muted);font-size:13px}.doc-panel[open]>summary{border-bottom:1px solid var(--line)}.doc-panel>.handover{border:0;border-radius:0 0 13px 13px}
.status-card h3{font-size:17px}.status-card.done{border-top:4px solid var(--green)}.status-card.working{border-top:4px solid var(--amber)}.status-card.next{border-top:4px solid var(--teal)}.status-card ul{padding-left:20px;max-height:320px;overflow:auto}.safety-grid .plain-card ul{padding-left:20px}.test-list{list-style:none;padding:0!important}.test-list li{display:flex;justify-content:space-between;border-bottom:1px solid var(--line);padding:7px 0}.handover-lite h3,.handover-lite h4{margin-top:0}
.history-panel>summary{padding:18px 20px}.history-list{display:grid;gap:0;padding:0 20px 20px}.history-item{display:grid;grid-template-columns:100px 1fr;gap:18px;padding:17px 0;border-top:1px solid var(--line)}.history-item time{color:var(--teal);font-size:13px;font-weight:800}.history-item p{margin:4px 0;color:var(--muted)}.history-item small{color:var(--muted)}
.handover{padding:28px;background:#fff;border:1px solid var(--line);border-radius:18px}.handover h2:first-child{display:none}.handover h3{margin-top:30px;border-bottom:1px solid var(--line);padding-bottom:7px}.handover h4{margin-top:24px}.handover pre{overflow:auto;padding:15px;border-radius:10px;background:#102a43;color:#eaf7f8;line-height:1.55}.handover code{font-family:"Cascadia Code",Consolas,monospace}.handover li{margin:6px 0}.handover :not(pre)>code{padding:1px 6px;border-radius:6px;background:var(--teal-soft);color:var(--navy);font-size:.92em;word-break:break-all}.handover .table-wrap{overflow-x:auto;margin:14px 0}.handover table{width:100%;border-collapse:collapse;font-size:14px}.handover th,.handover td{padding:9px 12px;border:1px solid var(--line);text-align:left;vertical-align:top}.handover th{background:var(--teal-soft)}.handover blockquote{margin:14px 0;padding:10px 16px;border-left:4px solid var(--amber);background:#fff8ec;border-radius:0 10px 10px 0}.handover blockquote p{margin:4px 0}.handover hr{border:0;border-top:1px solid var(--line);margin:26px 0}.handover a{color:var(--teal)}.guide-block{margin-top:14px}.status-badge{display:inline-block;padding:2px 10px;border-radius:999px;font-weight:700;font-size:13px;white-space:nowrap;border:1px solid transparent}.status-done{background:#e3f5ea;color:#1d6b43;border-color:#b7e2c8}.status-working{background:#fff1d6;color:#8a5300;border-color:#f3d49a}.status-todo{background:#fde8e8;color:#a3261f;border-color:#f5bdb9}.status-decide{background:#e8eefc;color:#2446a3;border-color:#bccbf2}.status-na{background:#eef1f4;color:#4b5563;border-color:#d5dbe1}.handover th .status-badge{font-size:14px}.guide-title{font-size:22px;margin:0 0 12px;padding-top:6px}.footer-note{margin-top:30px;color:var(--muted);font-size:12px}
.mentoring-evidence{margin-top:24px}.mentoring-evidence>summary{padding:18px 20px;color:var(--teal)}.mentoring-evidence-item{padding:20px}.mentoring-evidence-item+.mentoring-evidence-item{border-top:1px solid var(--line)}
.mentoring-diagrams{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px;margin:16px 0}.mentoring-diagram{margin:0;padding:16px;background:#fff;border:1px solid var(--line);border-radius:16px}.mentoring-diagram figcaption{display:grid;gap:3px;margin-bottom:12px}.mentoring-diagram figcaption span{color:var(--muted);font-size:13px}.mentoring-diagram img{display:block;width:100%;height:auto;border:1px solid var(--line);border-radius:10px;background:#fff}.mentoring-diagram.wide{grid-column:1/-1}.mentoring-diagram iframe{display:block;width:100%;height:760px;border:1px solid var(--line);border-radius:10px;background:#fff}
.pager{display:flex;justify-content:space-between;gap:12px;margin-top:46px;padding-top:20px;border-top:1px solid var(--line)}.pager a{padding:10px 16px;border:1px solid var(--line);border-radius:10px;background:#fff;text-decoration:none;color:var(--teal);font-weight:700}.pager a:hover{background:var(--teal-soft)}
@media(max-width:1100px){.reading-order{grid-template-columns:repeat(3,minmax(0,1fr))}}
@media(max-width:900px){.tech-grid,.workflow,.card-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.status-grid{grid-template-columns:1fr}}
@media(max-width:760px){.layout{display:block}aside{position:sticky;z-index:10;height:auto;padding:14px 16px;border-right:0;border-bottom:1px solid var(--line)}aside>p{display:none}.menu-toggle{display:flex;justify-content:space-between;align-items:center;width:100%;margin-top:10px;padding:10px 14px;border:1px solid var(--line);border-radius:10px;background:var(--teal-soft);color:var(--navy);font:inherit;font-weight:700}#site-nav{margin-top:10px}.js #site-nav:not(.open){display:none}main{width:min(100% - 24px,1080px);padding-top:20px}.hero{padding:26px 20px}section{margin-top:32px}.tech-grid,.workflow,.flow-pair,.status-grid,.safety-grid,.mentoring-diagrams,.card-grid,.reading-order{grid-template-columns:1fr}.mentoring-diagram iframe{height:560px}.folder summary{align-items:flex-start;flex-direction:column;gap:4px}.folder code{min-width:0}.history-item{grid-template-columns:1fr;gap:4px}.handover{padding:20px 16px}.pager{flex-direction:column}}
"""


def build_docs_view(repository_root: Path, output_dir: Path) -> None:
    root = repository_root.resolve()
    if (root / "docs").resolve().parent != root:
        raise ValueError("문서 정본은 이 저장소의 docs여야 합니다.")
    output_dir.mkdir(parents=True, exist_ok=True)
    diagram_source = root / "docs/02_멘토링/산출물_2026-09-30/그림"
    diagram_output = output_dir / "assets/mentoring"
    diagram_output.mkdir(parents=True, exist_ok=True)
    for filename in (
        "시스템_아키텍처.svg",
        "질문_처리_흐름.svg",
        "문서_등록_DFD.svg",
        "저장_구조_ERD.svg",
    ):
        shutil.copyfile(diagram_source / filename, diagram_output / filename)
    shutil.copyfile(
        diagram_source.parent / f"17_{MERGED_ARCHITECTURE}",
        diagram_output / MERGED_ARCHITECTURE,
    )
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
