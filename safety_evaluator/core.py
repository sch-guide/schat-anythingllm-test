"""Fail-closed adapter around the existing SCHAT Python validators."""

from __future__ import annotations

import hashlib
import json
import re
import unicodedata
from dataclasses import asdict
from typing import Any, Mapping, Sequence

from src.controlled_generation import (
    ControlledGenerationError,
    _normalized_numeric_tokens,
    build_controlled_generation_prompt,
    build_controlled_generation_schema,
    validate_controlled_paraphrase,
)
from src.evidence import SourceUnit, _action_families, _source_unit_phases, source_sentences
from src.prompt_config import load_evaluation_prompt
from src.query import classify
from tools.evaluation_action_strength import validate_action_strength

MAX_SOURCE_UNITS = 16
MAX_EMPLOYEE_SOURCE_UNITS = 4
_DOCUMENT_METADATA = re.compile(
    r"<document_metadata\b[^>]*>.*?</document_metadata>", re.IGNORECASE | re.DOTALL
)
_SVG = re.compile(r"<svg\b[^>]*>.*?</svg>", re.IGNORECASE | re.DOTALL)
_TECHNICAL_TAG = re.compile(r"</?(?:document_metadata|svg)\b[^>]*>", re.IGNORECASE)
_WORD = re.compile(r"[0-9A-Za-z가-힣]+")
_QUERY_STOPWORDS = {
    "알려줘",
    "알려주세요",
    "무엇",
    "무엇인가요",
    "어떻게",
    "관련",
    "대한",
    "질문",
}
_KOREAN_PARTICLES = ("에서", "으로", "부터", "까지", "에게", "을", "를", "은", "는", "이", "가", "에", "로", "와", "과", "의", "도", "만")
_PROHIBITION = re.compile(r"금기|금지|해서는\s*안|하면\s*안|하지\s*말")
_CAUTION_ONLY = re.compile(r"주의|유의|권고|권장|고려")


class SafetyContractError(ValueError):
    pass


def _required_string(value: Any, name: str, maximum: int) -> str:
    if not isinstance(value, str) or not value.strip() or len(value) > maximum:
        raise SafetyContractError(f"invalid_{name}")
    return value.strip()


def _display_source(chunk: Mapping[str, Any]) -> dict[str, Any]:
    page = chunk.get("page")
    if page is not None and (not isinstance(page, int) or page < 1):
        page = None
    return {
        "document_name": str(chunk.get("document_name") or chunk.get("title") or "").strip(),
        "page": page,
        "section": str(chunk.get("section") or "").strip(),
    }


def _clean_source_text(text: str) -> str:
    text = _DOCUMENT_METADATA.sub(" ", text)
    text = _SVG.sub(" ", text)
    text = _TECHNICAL_TAG.sub(" ", text)
    return re.sub(r"[ \t]+", " ", text).strip()


def _query_terms(question: str) -> tuple[str, ...]:
    normalized = unicodedata.normalize("NFKC", question)
    terms: list[str] = []
    for token in _WORD.findall(normalized):
        if token in _QUERY_STOPWORDS:
            continue
        for particle in _KOREAN_PARTICLES:
            if token.endswith(particle) and len(token) - len(particle) >= 2:
                token = token[: -len(particle)]
                break
        if len(token) >= 2:
            terms.append(token)
    return tuple(terms)


def _sentence_relevance(sentence: str, terms: Sequence[str]) -> int:
    normalized = unicodedata.normalize("NFKC", sentence).casefold()
    return sum(1 for term in terms if term.casefold() in normalized)


def _select_relevant_sentences(text: str, question: str) -> tuple[tuple[int, str], ...]:
    cleaned = _clean_source_text(text)
    candidates = [
        (position, sentence.strip())
        for position, sentence in enumerate(source_sentences(cleaned), start=1)
        if sentence.strip()
    ]
    terms = _query_terms(question)
    scored = [
        (position, sentence, _sentence_relevance(sentence, terms))
        for position, sentence in candidates
    ]
    best_score = max((item[2] for item in scored), default=0)
    relevant = [item for item in scored if item[2] == best_score and best_score > 0]
    if not relevant and len(candidates) == 1:
        return tuple(candidates)
    relevant.sort(key=lambda item: (-item[2], item[0]))
    selected = sorted(relevant[:MAX_EMPLOYEE_SOURCE_UNITS], key=lambda item: item[0])
    return tuple((position, sentence) for position, sentence, _score in selected)


def _build_units(
    retrieved_chunks: Sequence[Mapping[str, Any]], question: str
) -> tuple[SourceUnit, ...]:
    units: list[SourceUnit] = []
    ordinal = 1
    for rank, chunk in enumerate(retrieved_chunks, start=1):
        chunk_id = _required_string(chunk.get("chunk_id"), "chunk_id", 200)
        document_id = _required_string(chunk.get("document_id"), "document_id", 200)
        text = _required_string(chunk.get("text"), "source_text", 12000)
        current_phase = "unspecified"
        for position, sentence in _select_relevant_sentences(text, question):
            if ordinal > MAX_SOURCE_UNITS:
                break
            phases = _source_unit_phases(sentence)
            if len(phases) == 1:
                current_phase = next(iter(phases))
            phase = current_phase if len(phases) <= 1 else "unspecified"
            units.append(
                SourceUnit(
                    source_unit_id=f"su{ordinal:03d}",
                    chunk_id=chunk_id,
                    source_order=(int(chunk.get("rank") or rank), position),
                    branch="common",
                    exact_text=sentence,
                    group_key=f"{document_id}:{chunk_id}",
                    required=True,
                    selectable=True,
                    phase=phase,
                    action_families=_action_families(sentence),
                )
            )
            ordinal += 1
        if ordinal > MAX_SOURCE_UNITS:
            break
    if not units:
        raise SafetyContractError("no_source_units")
    return tuple(units)


def _fingerprint(question: str, units: Sequence[SourceUnit]) -> str:
    payload = {
        "question": question,
        "units": [
            {
                "source_unit_id": unit.source_unit_id,
                "chunk_id": unit.chunk_id,
                "exact_text": unit.exact_text,
            }
            for unit in units
        ],
    }
    return hashlib.sha256(
        json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()
    ).hexdigest()


def prepare_contract(*, request_id: str, question: str, retrieved_chunks: Sequence[Mapping[str, Any]]) -> dict[str, Any]:
    request_id = _required_string(request_id, "request_id", 120)
    question = _required_string(question, "question", 1000)
    if not isinstance(retrieved_chunks, Sequence) or isinstance(retrieved_chunks, (str, bytes)):
        raise SafetyContractError("invalid_retrieved_chunks")
    units = _build_units(retrieved_chunks, question)
    intent = classify(question)
    config = load_evaluation_prompt()
    schema = build_controlled_generation_schema(units)
    prompt = build_controlled_generation_prompt(
        units,
        config=config,
        intent=intent,
        preserve_source_order=intent == "procedure",
    )
    prompt = (
        f"{prompt}\n"
        "추가 보존 규칙:\n"
        "- 질문에 직접 필요한 선택된 SourceUnit만 사용합니다.\n"
        "- 근거 전체를 반복하지 말고 질문에 필요한 사실만 답합니다.\n"
        "- 선택되지 않은 SourceUnit이나 질문과 무관한 사실을 추가하지 않습니다.\n"
        "- 숫자, 시간, 조건, 금기, 부정, 행위 종류와 강도를 바꾸지 않습니다.\n"
        f"QUESTION:\n{question}"
    )
    display_sources = []
    selected_chunk_ids = {unit.chunk_id for unit in units}
    for chunk in retrieved_chunks:
        if chunk.get("chunk_id") not in selected_chunk_ids:
            continue
        display = _display_source(chunk)
        if display not in display_sources:
            display_sources.append(display)
    fallback_text = "\n\n".join(unit.exact_text for unit in units)
    return {
        "schema_version": "1",
        "request_id": request_id,
        "contract_id": _fingerprint(question, units),
        "intent": intent,
        "structured_output_schema": schema,
        "generation_prompt": prompt,
        "source_units": [asdict(unit) for unit in units],
        "display_sources": display_sources,
        "fallback": {
            "text": fallback_text,
            "sources": display_sources,
        },
        "retry_count": 0,
    }


def _fallback(prepared: Mapping[str, Any], code: str, *, stage: str) -> dict[str, Any]:
    return {
        "decision": "FAIL",
        "review_candidate_allowed": False,
        "fallback_to_extractive": True,
        "retry_count": 0,
        "error_code": code,
        "display_output": {
            "kind": "extractive_fallback",
            **dict(prepared.get("fallback") or {}),
        },
        "diagnostic": {"first_failure_stage": stage, "error_code": code},
    }


def _units_from_prepared(prepared: Mapping[str, Any]) -> tuple[SourceUnit, ...]:
    raw = prepared.get("source_units")
    if not isinstance(raw, list) or not raw:
        raise SafetyContractError("invalid_evidence_catalog")
    return tuple(SourceUnit(**value) for value in raw)


def validate_candidate(prepared: Mapping[str, Any], candidate: Mapping[str, Any]) -> dict[str, Any]:
    try:
        units = _units_from_prepared(prepared)
        validated = validate_controlled_paraphrase(
            candidate,
            units,
            intent=str(prepared.get("intent") or "fact"),
            require_all_evidence=True,
        )
    except (ControlledGenerationError, SafetyContractError, TypeError, ValueError) as exc:
        return _fallback(prepared, str(exc), stage="controlled_candidate")

    by_id = {unit.source_unit_id: unit for unit in units}
    for statement in candidate["statements"]:
        source_ids = tuple(statement["supporting_source_unit_ids"])
        cited = {source_id: by_id[source_id].exact_text for source_id in source_ids}
        action = validate_action_strength(statement_text=statement["text"], cited_sources=cited)
        if not action.passed:
            return _fallback(
                prepared,
                action.error_code or "evaluation_action_strength_changed",
                stage="action_strength",
            )
        source_text = " ".join(cited.values())
        source_tokens = _normalized_numeric_tokens(source_text)
        candidate_tokens = _normalized_numeric_tokens(statement["text"])
        if not source_tokens.issubset(candidate_tokens):
            return _fallback(
                prepared,
                "required_clinical_token_omitted",
                stage="clinical_token_coverage",
            )
        if _PROHIBITION.search(source_text) and not _PROHIBITION.search(statement["text"]):
            code = "prohibition_weakened" if _CAUTION_ONLY.search(statement["text"]) else "prohibition_omitted"
            return _fallback(prepared, code, stage="negation_prohibition")

    text = "\n\n".join(statement.text for statement in validated.statements)
    return {
        "decision": "PASS",
        "review_candidate_allowed": True,
        "fallback_to_extractive": False,
        "retry_count": 0,
        "error_code": None,
        "display_output": {
            "kind": "candidate",
            "text": text,
            "sources": list(prepared.get("display_sources") or []),
        },
        "diagnostic": {"first_failure_stage": None, "error_code": None},
    }
