"""운영 청크를 바꾸지 않고 객관적인 품질 수치를 계산한다."""

import re
from collections import Counter
from collections.abc import Callable, Iterable
from dataclasses import dataclass


@dataclass(frozen=True)
class ChunkDraft:
    text: str
    section: str
    kind: str
    parent_id: str
    page_number: int | None
    location: str
    sentence_cut_suspected: bool = False


def _sentence_parts(text):
    parts = re.findall(r'.+?(?:[.!?。](?=\s|$)|$)', text.strip(), re.S)
    return [part.strip() for part in parts if part.strip()]


def _split_oversized(unit, count_tokens, max_tokens):
    sentences = _sentence_parts(unit.text)
    result, current = [], ''
    for sentence in sentences:
        combined = (current + ' ' + sentence).strip()
        if current and count_tokens(combined) > max_tokens:
            result.append((current, False))
            current = sentence
        else:
            current = combined
        if count_tokens(current) > max_tokens:
            words, piece = current.split(), ''
            for word in words:
                candidate = (piece + ' ' + word).strip()
                if piece and count_tokens(candidate) > max_tokens:
                    result.append((piece, True))
                    piece = word
                else:
                    piece = candidate
            current = piece
    if current:
        result.append((current, count_tokens(current) > max_tokens))
    return result


def pack_semantic_units(
    units, count_tokens, *, max_tokens=110, target_tokens=95, overlap_tokens=20
):
    """의미 단위를 유지하며 검색모델 길이 안의 청크 초안을 만든다."""
    del overlap_tokens  # 겹침은 긴 문장의 완결 경계를 해치지 않는 후속 최적화로 남긴다.
    drafts = []
    for unit in units:
        if count_tokens(unit.text) <= max_tokens:
            if (drafts and unit.kind == 'prose' and drafts[-1].kind == 'prose'
                    and drafts[-1].section == unit.section
                    and drafts[-1].parent_id == unit.parent_id
                    and count_tokens(drafts[-1].text + '\n' + unit.text) <= target_tokens):
                previous = drafts.pop()
                drafts.append(ChunkDraft(
                    previous.text + '\n' + unit.text, unit.section, unit.kind,
                    unit.parent_id, unit.page_number, unit.location,
                ))
            else:
                drafts.append(ChunkDraft(
                    unit.text, unit.section, unit.kind, unit.parent_id,
                    unit.page_number, unit.location,
                ))
            continue
        for text, suspected in _split_oversized(unit, count_tokens, max_tokens):
            drafts.append(ChunkDraft(
                text, unit.section, unit.kind, unit.parent_id,
                unit.page_number, unit.location, suspected,
            ))
    return tuple(drafts)


def structural_quality(drafts, count_tokens):
    values = tuple(drafts)
    return {
        'orphan_headings': sum(d.kind == 'heading_body' and '\n' not in d.text for d in values),
        'sentence_cut_suspected': sum(d.sentence_cut_suspected for d in values),
        'table_structure_suspected': sum(d.kind == 'table_row' and '\n' not in d.text for d in values),
        'step_structure_suspected': sum(
            d.kind == 'step' and not re.match(r'^\s*\d+(?:\.\d+)*[.)]\s+', d.text)
            for d in values
        ),
        'missing_locations': sum(d.page_number is None and not d.location for d in values),
        'max_tokens': max((count_tokens(d.text) for d in values), default=0),
    }


def _lines(text):
    return [line.strip() for line in text.splitlines() if line.strip()]


def _page_edge_lines(page):
    lines = _lines(page.text)
    return set(lines[:3] + lines[-3:])


def _page_label_candidate(text):
    if not text or len(text) > 60 or " | " in text:
        return False
    if re.search(r"(?:다[.!?]?|[。.!?])$", text):
        return False
    if re.search(r"\d\s*(?:mg|ml|㎎|㎖|℃|분|시간|회|%)", text, re.I):
        return False
    return bool(re.search(r"[가-힣A-Za-z]", text))


def repeated_edge_labels(pages):
    """서로 다른 페이지 가장자리에 반복되는 짧은 검색 표지를 찾는다."""
    counts = Counter(
        line
        for page in pages
        for line in _page_edge_lines(page)
        if _page_label_candidate(line)
    )
    return frozenset(line for line, count in counts.items() if count >= 2)


def repeated_edge_label_count(pages, labels):
    """본문의 같은 문구는 제외하고 페이지 가장자리 표지 수만 센다."""
    return sum(len(_page_edge_lines(page).intersection(labels)) for page in pages)


def validate_chunk_texts(
    texts: Iterable[str],
    count_tokens: Callable[[str], int],
    max_tokens: int = 110,
) -> dict[str, int]:
    """운영 전에 확인할 객관적인 청크 품질 수치를 계산한다."""
    values = list(texts)
    normalized = [re.sub(r"\s+", " ", value).strip().casefold() for value in values]
    nonempty = [value for value in normalized if value]
    return {
        "empty": sum(not value for value in normalized),
        "too_long": sum(count_tokens(value) > max_tokens for value in values),
        "duplicates": len(nonempty) - len(set(nonempty)),
        "max_tokens": max((count_tokens(value) for value in values), default=0),
    }
