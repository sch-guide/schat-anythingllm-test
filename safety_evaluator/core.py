"""Fail-closed adapter around the existing SCHAT Python validators."""

from __future__ import annotations

import hashlib
import json
import re
import unicodedata
from dataclasses import asdict, replace
from typing import Any, Mapping, Sequence

from safety_evaluator.coverage_policy import (
    build_coverage_policy,
    coverage_policy_from_dict,
    validate_required_coverage,
)
from safety_evaluator.table_evidence import (
    extract_verified_table_items,
    format_table_fallback,
)
from src.controlled_generation import (
    ControlledGenerationError,
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
MAX_PROCEDURE_SOURCE_UNITS = 8
_DOCUMENT_METADATA = re.compile(
    r"<document_metadata\b[^>]*>.*?(?:</document_metadata>|$)",
    re.IGNORECASE | re.DOTALL,
)
_SVG = re.compile(r"<svg\b[^>]*>.*?(?:</svg>|$)", re.IGNORECASE | re.DOTALL)
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
    "사항",
}
_FOCUS_TERMS = {
    "종류",
    "목적",
    "절차",
    "대상",
    "방법",
    "준비",
    "주의",
    "금기",
    "용량",
    "속도",
    "시간",
}
_KOREAN_PARTICLES = ("에서", "으로", "부터", "까지", "에게", "을", "를", "은", "는", "이", "가", "에", "로", "와", "과", "의", "도", "만")
_QUESTION_ENDINGS = (
    "하나요",
    "인가요",
    "되나요",
    "합니까",
    "입니까",
    "나요",
    "가요",
    "요",
)
_TERM_EQUIVALENTS = {
    "예외": ("예외", "제외"),
    "금기": ("금기", "금지"),
}
_PROHIBITION = re.compile(r"금기|금지|해서는\s*안|하면\s*안|하지\s*말")
_CAUTION_ONLY = re.compile(r"주의|유의|권고|권장|고려")
_NON_ANSWER_PROCEDURE_MATERIAL = re.compile(
    r"예시|예제|샘플|교육용|연습용|작성\s*예", re.IGNORECASE
)
_VALIDATION_EQUIVALENTS = (
    (re.compile(r"수행|실시"), "ACTIONEXECUTE"),
    (re.compile(r"시행"), "ACTIONEXECUTE"),
    (re.compile(r"점검"), "ACTIONVERIFY"),
    (re.compile(r"확인"), "ACTIONVERIFY"),
    (re.compile(r"중지"), "ACTIONSTOP"),
    (re.compile(r"중단"), "ACTIONSTOP"),
    (re.compile(r"투약|주입"), "ACTIONADMINISTER"),
    (re.compile(r"투여"), "ACTIONADMINISTER"),
    (re.compile(r"반드시|필수"), "REQUIRED"),
)


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
        for particle in _KOREAN_PARTICLES:
            if token.endswith(particle) and len(token) - len(particle) >= 2:
                token = token[: -len(particle)]
                break
        for ending in _QUESTION_ENDINGS:
            if token.endswith(ending) and len(token) - len(ending) >= 2:
                token = token[: -len(ending)]
                break
        if token.endswith("량") and len(token) >= 3:
            token = token[:-1]
        if len(token) >= 2 and token not in _QUERY_STOPWORDS:
            terms.append(token)
    return tuple(dict.fromkeys(terms))


def _sentence_relevance(sentence: str, terms: Sequence[str]) -> int:
    normalized = unicodedata.normalize("NFKC", sentence).casefold()
    return sum(
        2 if term in _FOCUS_TERMS else 1
        for term in terms
        if any(
            equivalent.casefold() in normalized
            for equivalent in _TERM_EQUIVALENTS.get(term, (term,))
        )
    )


def _is_structural_heading(
    sentence: str, section: str = "", *, intent: str = "fact"
) -> bool:
    normalized = re.sub(r"^#{1,6}\s+", "", sentence).strip()
    normalized = re.sub(r"^\d+(?:\.\d+)*[.)]?\s+", "", normalized).strip()
    if not normalized or re.search(r"[.!?。！？]$", normalized):
        return False
    if section and normalized.casefold() == section.strip().casefold():
        return True
    if bool(
        len(normalized) <= 90
        and re.search(
            r"(?:정의|목적|종류|절차|순서|대상|범위|주의사항|준비사항|확인사항|관리|방법|기준)$",
            normalized,
        )
    ):
        return True
    return bool(
        intent == "procedure"
        and len(normalized) <= 12
        and re.fullmatch(r"[0-9A-Za-z가-힣 /·_-]+", normalized)
        and not re.match(r"^(?:[-•●▪Ÿ*※]|[①-⑳]|\d+[.)])", normalized)
        and not _action_families(normalized)
    )


def _select_relevant_sentences(
    text: str, question: str, *, section: str = "", intent: str = "fact"
) -> tuple[tuple[int, str, int], ...]:
    cleaned = _clean_source_text(text)
    table_items = extract_verified_table_items(
        cleaned, question=question, section=section
    )
    if intent == "types" and table_items:
        return tuple(
            (position, item, 100)
            for position, item in enumerate(table_items, start=1)
        )
    candidates = [
        (position, sentence.strip())
        for position, sentence in enumerate(source_sentences(cleaned), start=1)
        if sentence.strip()
    ]
    terms = _query_terms(question)
    scored = [
        (
            position,
            sentence,
            _sentence_relevance(sentence, terms) * 10
            + _sentence_relevance(section, terms),
        )
        for position, sentence in candidates
        if _sentence_relevance(sentence, terms) > 0
    ]
    best_score = max((item[2] for item in scored), default=0)
    if intent in {"procedure", "types"} and best_score > 0:
        anchor_position = min(item[0] for item in scored if item[2] == best_score)
        anchor_is_heading = any(
            position == anchor_position
            and _is_structural_heading(sentence, section, intent=intent)
            for position, sentence in candidates
        )
        sequence: list[tuple[int, str, int]] = []
        for position, sentence in candidates:
            if position < anchor_position:
                continue
            if _is_structural_heading(sentence, section, intent=intent):
                if sequence:
                    break
                continue
            sequence.append((position, sentence, best_score))
            if len(sequence) >= MAX_EMPLOYEE_SOURCE_UNITS:
                break
        if sequence:
            return tuple(sequence)
        if anchor_is_heading:
            return ()
    relevant = [item for item in scored if item[2] == best_score and best_score > 0]
    relevant.sort(key=lambda item: (-item[2], item[0]))
    selected = sorted(relevant[:MAX_EMPLOYEE_SOURCE_UNITS], key=lambda item: item[0])
    return tuple(selected)


def _evidence_selection_intent(question: str, classified_intent: str) -> str:
    terms = set(_query_terms(question))
    if "종류" in terms:
        return "types"
    return classified_intent


def _answer_style(question: str, intent: str) -> str:
    """Choose presentation metadata without changing retrieval or validation."""
    if intent == "types" or "종류" in question:
        return "list"
    if intent == "procedure":
        return "numbered_steps"
    if intent in {"preparation", "materials"}:
        return "checklist"
    if intent == "comparison":
        return "comparison"
    if "서류" in question:
        return "list"
    return "explanation"


def _answer_style_prompt(answer_style: str) -> str:
    shared = (
        "공통 표현 규칙:\n"
        "- 각 statement에는 검증받을 임상 내용만 작성합니다.\n"
        "- 숫자·단위·시간·속도·조건·금기와 행위 종류·강도는 근거와 같은 의미로 유지하고, 불확실하면 원문 표현을 그대로 사용합니다.\n"
        "- statement text 안에 목록 기호, 번호, 제목용 Markdown을 넣지 않습니다.\n"
        "- 직원 화면의 서식은 안전검사 통과 후 적용됩니다."
    )
    rules = {
        "list": (
            "종류형 답변 규칙:\n"
            "- 각 종류를 서로 다른 statement로 작성합니다.\n"
            "- 매 항목에 같은 도입 문장이나 '있습니다' 표현을 반복하지 않습니다."
        ),
        "numbered_steps": (
            "절차형 답변 규칙:\n"
            "- 선택된 SourceUnit에 여러 단계가 있으면 모든 필수 단계를 원문 순서대로 작성합니다.\n"
            "- 직접 관련된 SourceUnit을 빠뜨리지 않고 직원이 실제 업무 흐름을 이해할 수 있을 정도로 충분히 설명합니다.\n"
            "- 근거 안에서 확인되는 표현만 사용해 '짧은 단계명: 설명' 형태로 자연스럽게 작성할 수 있습니다.\n"
            "- 각 단계를 서로 다른 statement로 작성합니다.\n"
            "- 제목 한 문장만 반복하지 말고, 실제 단계가 있으면 빠뜨리지 않습니다.\n"
            "- 성인·소아 등 서로 다른 대상·분기의 절차를 섞지 않습니다."
        ),
        "checklist": (
            "준비형 답변 규칙:\n"
            "- 각 준비사항을 서로 다른 statement로 작성합니다.\n"
            "- 같은 준비사항을 반복하지 않습니다."
        ),
        "comparison": (
            "비교형 답변 규칙:\n"
            "- 각 비교 항목을 서로 다른 statement로 작성합니다.\n"
            "- 무엇에 대한 사실인지 각 statement 안에서 분명히 합니다.\n"
            "- 근거에 없는 비교 관계를 만들지 않습니다."
        ),
        "explanation": (
            "설명형 답변 규칙:\n"
            "- 첫 statement에 질문에 대한 짧은 결론을 작성합니다.\n"
            "- 추가 근거가 있으면 이후 statement에 핵심 설명만 작성합니다."
        ),
    }
    return f"{rules[answer_style]}\n{shared}"


def _source_branch(section: str, sentence: str) -> str:
    label = f"{section} {sentence}"
    has_adult = "성인" in label
    has_pediatric = "소아" in label
    if has_adult and not has_pediatric:
        return "adult"
    if has_pediatric and not has_adult:
        return "pediatric"
    return "common"


def _build_units(
    retrieved_chunks: Sequence[Mapping[str, Any]], question: str
) -> tuple[SourceUnit, ...]:
    classified_intent = classify(question)
    intent = _evidence_selection_intent(question, classified_intent)
    candidates: list[tuple[int, int, int, str, str, str, str, bool]] = []
    for rank, chunk in enumerate(retrieved_chunks, start=1):
        chunk_id = _required_string(chunk.get("chunk_id"), "chunk_id", 200)
        document_id = _required_string(chunk.get("document_id"), "document_id", 200)
        text = _required_string(chunk.get("text"), "source_text", 12000)
        section = str(chunk.get("section") or "").strip()
        if intent == "procedure" and _NON_ANSWER_PROCEDURE_MATERIAL.search(
            f"{section} {text}"
        ):
            continue
        source_rank = int(chunk.get("rank") or rank)
        for position, sentence, score in _select_relevant_sentences(
            text, question, section=section, intent=intent
        ):
            candidates.append(
                (
                    score,
                    source_rank,
                    position,
                    chunk_id,
                    document_id,
                    sentence,
                    _source_branch(section, sentence),
                    chunk.get("schat_procedure_workflow_continuation") is True,
                )
            )

    if not candidates:
        raise SafetyContractError("no_source_units")
    if intent == "procedure":
        first_rank = min(candidate[1] for candidate in candidates)
        anchor = min(
            (candidate for candidate in candidates if candidate[1] == first_rank),
            key=lambda candidate: (candidate[2], candidate[3]),
        )
        anchor_document_id = anchor[4]
        anchor_branch = anchor[6]
        selected = [
            candidate
            for candidate in candidates
            if candidate[1] == first_rank
            or (
                candidate[7]
                and candidate[4] == anchor_document_id
                and (
                    candidate[6] == anchor_branch
                    or (anchor_branch != "common" and candidate[6] == "common")
                )
            )
        ]
    else:
        best_score = max(candidate[0] for candidate in candidates)
        selected = [candidate for candidate in candidates if candidate[0] == best_score]
    selected.sort(key=lambda candidate: (candidate[1], candidate[2], candidate[3]))
    source_unit_limit = (
        MAX_PROCEDURE_SOURCE_UNITS
        if intent == "procedure"
        else MAX_EMPLOYEE_SOURCE_UNITS
    )
    selected = selected[:source_unit_limit]

    units: list[SourceUnit] = []
    for ordinal, (
        _score,
        rank,
        position,
        chunk_id,
        document_id,
        sentence,
        branch,
        _workflow_continuation,
    ) in enumerate(selected, start=1):
        phases = _source_unit_phases(sentence)
        phase = next(iter(phases)) if len(phases) == 1 else "unspecified"
        units.append(
            SourceUnit(
                source_unit_id=f"su{ordinal:03d}",
                chunk_id=chunk_id,
                source_order=(rank, position),
                branch=branch,
                exact_text=sentence,
                group_key=f"{document_id}:{chunk_id}",
                required=intent in {"procedure", "types"} or ordinal == 1,
                selectable=True,
                phase=phase,
                action_families=_action_families(sentence),
            )
        )
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
    intent = _evidence_selection_intent(question, classify(question))
    answer_style = _answer_style(question, intent)
    coverage_policy = build_coverage_policy(
        intent=intent, units=units, question=question
    )
    config = load_evaluation_prompt()
    schema = build_controlled_generation_schema(units)
    prompt = build_controlled_generation_prompt(
        units,
        config=config,
        intent=intent,
        preserve_source_order=intent == "procedure",
        required_coverage=coverage_policy.prompt_rows(),
    )
    prompt = (
        f"{prompt}\n"
        "추가 보존 규칙:\n"
        "- 질문에 직접 필요한 선택된 SourceUnit만 사용합니다.\n"
        "- 질문과 직접 관련된 근거가 여러 개이면 모두 활용해 충분히 설명합니다.\n"
        "- 검색된 모든 청크를 반복하지 말고, 질문과 무관한 주변 설명은 생략합니다.\n"
        "- 선택되지 않은 SourceUnit이나 질문과 무관한 사실을 추가하지 않습니다.\n"
        "- 숫자, 시간, 조건, 금기, 부정, 행위 종류와 강도를 바꾸지 않습니다.\n"
        f"QUESTION:\n{question}"
    )
    prompt = f"{prompt}\n{_answer_style_prompt(answer_style)}"
    display_sources = []
    selected_chunk_ids = {unit.chunk_id for unit in units}
    for chunk in retrieved_chunks:
        if chunk.get("chunk_id") not in selected_chunk_ids:
            continue
        display = _display_source(chunk)
        if display not in display_sources:
            display_sources.append(display)
    if intent == "types":
        fallback_text = format_table_fallback(
            tuple(unit.exact_text for unit in units)
        )
    else:
        fallback_text = "\n\n".join(unit.exact_text for unit in units)
    return {
        "schema_version": "1",
        "request_id": request_id,
        "contract_id": _fingerprint(question, units),
        "intent": intent,
        "answer_style": answer_style,
        "structured_output_schema": schema,
        "generation_prompt": prompt,
        "source_units": [asdict(unit) for unit in units],
        "coverage_policy": coverage_policy.to_dict(),
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


def _validation_text(text: str) -> str:
    """Hide approved wording equivalents from regex-only invariant checks.

    The original text is still checked by the action/strength validator and is
    the only text returned to employees.
    """
    normalized = text
    for pattern, replacement in _VALIDATION_EQUIVALENTS:
        normalized = pattern.sub(replacement, normalized)
    return normalized


def _validation_candidate(candidate: Mapping[str, Any]) -> dict[str, Any]:
    statements = candidate.get("statements")
    if not isinstance(statements, list):
        return dict(candidate)
    return {
        **dict(candidate),
        "statements": [
            {
                **dict(statement),
                "text": _validation_text(str(statement.get("text") or "")),
            }
            if isinstance(statement, Mapping)
            else statement
            for statement in statements
        ],
    }


def validate_candidate(prepared: Mapping[str, Any], candidate: Mapping[str, Any]) -> dict[str, Any]:
    try:
        units = _units_from_prepared(prepared)
        validation_units = tuple(
            replace(unit, exact_text=_validation_text(unit.exact_text))
            for unit in units
        )
        validate_controlled_paraphrase(
            _validation_candidate(candidate),
            validation_units,
            intent=str(prepared.get("intent") or "fact"),
            require_all_evidence=False,
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
        if _PROHIBITION.search(source_text) and not _PROHIBITION.search(statement["text"]):
            code = "prohibition_weakened" if _CAUTION_ONLY.search(statement["text"]) else "prohibition_omitted"
            return _fallback(prepared, code, stage="negation_prohibition")

    try:
        coverage_policy = coverage_policy_from_dict(prepared.get("coverage_policy") or {})
    except ValueError as exc:
        return _fallback(prepared, str(exc), stage="coverage_policy")
    coverage = validate_required_coverage(
        policy=coverage_policy,
        candidate=candidate,
    )
    if not coverage.passed:
        return _fallback(
            prepared,
            coverage.error_code or "required_evidence_omitted",
            stage="question_scoped_coverage",
        )

    text = "\n\n".join(
        str(statement.get("text") or "").strip()
        for statement in candidate["statements"]
    )
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
        "diagnostic": {
            "first_failure_stage": None,
            "error_code": None,
            "warnings": list(coverage.warnings),
        },
    }
