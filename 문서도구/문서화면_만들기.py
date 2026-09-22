from __future__ import annotations

import argparse
import html
import re
from pathlib import Path

DATE_FILE = re.compile(r"^(\d{4}-\d{2}-\d{2})_")


def _without_frontmatter(markdown: str) -> str:
    if not markdown.startswith("---\n"):
        return markdown
    _, separator, body = markdown[4:].partition("\n---\n")
    return body if separator else markdown


def _title(markdown: str, fallback: str) -> str:
    markdown = _without_frontmatter(markdown)
    for line in markdown.splitlines():
        if line.startswith("# "):
            return line[2:].strip()
    return fallback


def _plain_text(markdown: str) -> str:
    markdown = _without_frontmatter(markdown)
    for line in markdown.splitlines():
        if line.startswith(("#", "|", "```")):
            continue
        text = re.sub(r"\[([^]]+)]\([^)]+\)", r"\1", line)
        text = text.lstrip("-0123456789. ").strip()
        if text:
            return text
    return "문서를 열어 자세한 내용을 확인할 수 있습니다."


def _render_markdown(markdown: str) -> str:
    markdown = _without_frontmatter(markdown)
    result: list[str] = []
    in_list = False
    lines = markdown.splitlines()
    index = 0
    while index < len(lines):
        stripped = lines[index].strip()
        if not stripped:
            if in_list:
                result.append("</ul>")
                in_list = False
            index += 1
            continue
        if stripped.startswith("|"):
            if in_list:
                result.append("</ul>")
                in_list = False
            rows: list[list[str]] = []
            while index < len(lines) and lines[index].strip().startswith("|"):
                cells = [cell.strip() for cell in lines[index].strip().strip("|").split("|")]
                if not all(re.fullmatch(r":?-{3,}:?", cell) for cell in cells):
                    rows.append(cells)
                index += 1
            if rows:
                header, *body_rows = rows
                result.append("<table><thead><tr>")
                result.extend(f"<th>{html.escape(cell)}</th>" for cell in header)
                result.append("</tr></thead><tbody>")
                for row in body_rows:
                    result.append("<tr>")
                    result.extend(f"<td>{html.escape(cell)}</td>" for cell in row)
                    result.append("</tr>")
                result.append("</tbody></table>")
            continue
        if stripped.startswith("### "):
            result.append(f"<h4>{html.escape(stripped[4:])}</h4>")
        elif stripped.startswith("## "):
            result.append(f"<h3>{html.escape(stripped[3:])}</h3>")
        elif stripped.startswith("# "):
            result.append(f"<h2>{html.escape(stripped[2:])}</h2>")
        elif stripped.startswith(("- ", "* ")):
            if not in_list:
                result.append("<ul>")
                in_list = True
            result.append(f"<li>{html.escape(stripped[2:])}</li>")
        else:
            result.append(f"<p>{html.escape(stripped)}</p>")
        index += 1
    if in_list:
        result.append("</ul>")
    return "\n".join(result)


def build_docs_view(repository_root: Path, output_dir: Path) -> None:
    docs_root = (repository_root / "docs").resolve()
    repository_root = repository_root.resolve()
    if docs_root.parent != repository_root:
        raise ValueError("문서 정본은 이 저장소 내부의 docs여야 합니다.")

    documents: list[dict[str, str]] = []
    for path in sorted(docs_root.rglob("*.md")):
        if "superpowers" in path.relative_to(docs_root).parts:
            continue
        markdown = path.read_text(encoding="utf-8")
        relative = path.relative_to(docs_root).as_posix()
        documents.append(
            {
                "path": relative,
                "title": _title(markdown, path.stem),
                "summary": _plain_text(markdown),
                "body": _render_markdown(markdown),
                "date": DATE_FILE.match(path.name).group(1)
                if DATE_FILE.match(path.name)
                else "",
            }
        )

    dated = sorted((item for item in documents if item["date"]), key=lambda item: item["date"], reverse=True)
    current = next(
        (item for item in documents if item["path"] == "00_현재상태/현재_프로젝트_상태.md"),
        None,
    )
    if current is None:
        raise ValueError("현재 상태 문서가 없습니다.")

    cards = "".join(
        f'<button class="change" data-target="doc-{index}"><span>{html.escape(item["date"])}</span>'
        f'<strong>{html.escape(item["title"])}</strong><small>{html.escape(item["summary"])}</small></button>'
        for index, item in enumerate(documents)
        if item in dated
    )
    navigation = "".join(
        f'<button data-target="doc-{index}">{html.escape(item["title"])}</button>'
        for index, item in enumerate(documents)
    )
    articles = "".join(
        f'<article id="doc-{index}" hidden><p class="source">공식 문서 · docs/{html.escape(item["path"])}</p>{item["body"]}</article>'
        for index, item in enumerate(documents)
    )
    current_index = documents.index(current)
    page = f"""<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>SCHAT 기능 비교 테스트</title><style>
:root{{--navy:#102a43;--teal:#087f8c;--bg:#f3f7fa;--line:#d8e2ea;--muted:#627d98}}
*{{box-sizing:border-box}}body{{margin:0;background:var(--bg);color:var(--navy);font-family:Pretendard,"Noto Sans KR","Segoe UI",sans-serif}}
.layout{{display:grid;grid-template-columns:290px 1fr;min-height:100vh}}aside{{padding:26px 18px;background:#fff;border-right:1px solid var(--line)}}
aside h1{{font-size:20px;margin:0 0 6px}}aside p{{color:var(--muted);font-size:13px}}nav{{display:grid;gap:7px;margin-top:24px}}button{{font:inherit}}
nav button,.change{{border:1px solid var(--line);border-radius:10px;background:#fff;color:var(--navy);text-align:left;cursor:pointer}}
nav button{{padding:10px}}nav button:hover,.change:hover{{border-color:var(--teal)}}main{{width:min(100% - 40px,980px);margin:0 auto;padding:42px 0 70px}}
.hero{{padding:30px;border-radius:20px;background:linear-gradient(135deg,#0d7180,#102a43);color:#fff}}.hero small{{opacity:.78}}.hero h2{{font-size:34px;margin:8px 0}}
.section-title{{margin:34px 0 14px}}.changes{{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}}.change{{padding:18px;display:grid;gap:7px}}
.change span{{color:var(--teal);font-size:12px;font-weight:800}}.change small{{color:var(--muted);line-height:1.5}}article{{margin-top:28px;padding:30px;background:#fff;border:1px solid var(--line);border-radius:18px}}
article h2{{font-size:28px}}article h3{{margin-top:28px}}article p,article li{{line-height:1.75}}.source{{color:var(--muted);font-size:12px}}table{{width:100%;border-collapse:collapse;margin:16px 0}}th,td{{padding:11px;border:1px solid var(--line);text-align:left}}th{{background:#eef6f7}}
@media(max-width:760px){{.layout{{display:block}}aside{{border-right:0;border-bottom:1px solid var(--line)}}.changes{{grid-template-columns:1fr}}main{{width:min(100% - 24px,980px);padding-top:22px}}}}
</style></head><body><div class="layout"><aside><h1>SCHAT 기능 비교 테스트</h1><p>기존 SCHAT과 분리된 문서 화면</p><nav>{navigation}</nav></aside>
<main><section id="home"><div class="hero"><small>현재 상태</small><h2>{html.escape(current["title"])}</h2><p>{html.escape(current["summary"])}</p><button data-target="doc-{current_index}">현재 상태 자세히 보기</button></div><h2 class="section-title">날짜별 변경</h2><div class="changes">{cards}</div></section>{articles}</main></div>
<script>const home=document.getElementById('home');const articles=[...document.querySelectorAll('article')];document.querySelectorAll('[data-target]').forEach(button=>button.addEventListener('click',()=>{{home.hidden=true;articles.forEach(article=>article.hidden=article.id!==button.dataset.target);window.scrollTo(0,0)}}));</script>
</body></html>"""
    output_dir.mkdir(parents=True, exist_ok=True)
    (output_dir / "index.html").write_text(page, encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser(description="SCHAT 테스트 저장소 전용 문서 화면 생성")
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1]
    build_docs_view(root, args.output or root / "docs_view")
    print("이 저장소 전용 docs_view를 생성했습니다.")


if __name__ == "__main__":
    main()
