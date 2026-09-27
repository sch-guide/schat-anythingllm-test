"""Conservative helpers for employee-readable evidence from flattened tables."""

from __future__ import annotations

import re
from typing import Sequence

_DOCUMENT_METADATA = re.compile(
    r"<document_metadata\b[^>]*>.*?(?:</document_metadata>|$)",
    re.IGNORECASE | re.DOTALL,
)
_SVG = re.compile(r"<svg\b[^>]*>.*?(?:</svg>|$)", re.IGNORECASE | re.DOTALL)
_PAGE_MARKER = re.compile(r"^\s*-?\s*\d{1,4}\s*-?\s*$")
_BULLET = re.compile(r"^\s*(?:[-•●▪Ÿ*※]|[①-⑳]|\d+[.)])\s*")
_HEADER = {"종류", "구분", "분류", "항목"}
_STOP_HEADERS = {"목적", "절차", "주의사항", "준비사항", "대상", "범위"}


def _lines(text: str) -> tuple[str, ...]:
    cleaned = _DOCUMENT_METADATA.sub("\n", text)
    cleaned = _SVG.sub("\n", cleaned)
    values = []
    for raw in cleaned.splitlines():
        value = _BULLET.sub("", raw).strip()
        if not value or _PAGE_MARKER.fullmatch(value):
            continue
        values.append(value)
    return tuple(values)


def _is_verified_row(value: str) -> bool:
    if not 2 <= len(value) <= 80:
        return False
    if value in _HEADER or value in _STOP_HEADERS:
        return False
    if re.search(r"[.!?。！？]$", value):
        return False
    if re.search(r"(?:한다|합니다|된다|됩니다)$", value):
        return False
    return True


def _split_verified_compound_row(value: str) -> tuple[str, ...]:
    """Split only explicit repeated cell suffixes with an exact round trip."""
    if value.count("제제") + value.count("혈장") < 2:
        return ()
    parts = tuple(
        match.group(0).strip()
        for match in re.finditer(r".+?(?:제제|혈장)", value)
    )
    def compact(text: str) -> str:
        return re.sub(r"\s+", "", text)

    if len(parts) < 2 or compact("".join(parts)) != compact(value):
        return ()
    if not all(_is_verified_row(part) for part in parts):
        return ()
    return parts


def extract_verified_table_items(
    text: str, *, question: str, section: str = ""
) -> tuple[str, ...]:
    """Return only explicit one-line rows; never split an ambiguous flat row."""
    if "종류" not in question and "종류" not in section:
        return ()
    lines = _lines(text)
    try:
        start = next(index for index, value in enumerate(lines) if value in _HEADER)
    except StopIteration:
        return ()
    rows = []
    for value in lines[start + 1 :]:
        if value in _STOP_HEADERS:
            break
        if not _is_verified_row(value):
            return ()
        compound = _split_verified_compound_row(value)
        if compound:
            rows.extend(compound)
            break
        rows.append(value)
        if len(rows) > 16:
            return ()
    if len(rows) < 2:
        return ()
    return tuple(rows)


def format_table_fallback(items: Sequence[str]) -> str:
    return "\n".join(f"- {item}" for item in items if item.strip())
