"""Question-scoped coverage policy for the SCHAT safety adapter.

This module does not replace the existing SCHAT validators.  It narrows the
coverage obligation from every selected sentence to the facts required by the
current question, then reports omitted optional evidence as a warning.
"""

from __future__ import annotations

import re
import unicodedata
from dataclasses import asdict, dataclass
from typing import Any, Mapping, Sequence

from src.controlled_generation import _normalized_numeric_tokens
from src.evidence import SourceUnit, _action_families

_WORD = re.compile(r"[0-9A-Za-z가-힣]+")
_PARTICLES = (
    "에서는",
    "으로는",
    "에게는",
    "에서",
    "으로",
    "부터",
    "까지",
    "에게",
    "을",
    "를",
    "은",
    "는",
    "이",
    "가",
    "에",
    "로",
    "와",
    "과",
    "의",
    "도",
    "만",
)
_ENDINGS = (
    "합니다",
    "됩니다",
    "입니다",
    "한다",
    "된다",
    "이다",
    "하며",
    "하고",
    "하여",
    "해서",
)
_GENERIC = {
    "수혈",
    "관련",
    "내용",
    "사항",
    "경우",
    "방법",
    "종류",
    "절차",
    "목적",
    "단계",
    "안내",
    "제제",
    "환자",
    "mg",
    "mcg",
    "ml",
    "cc",
    "kg",
    "hr",
    "min",
    "합니다",
    "한다",
}
_ACTION_WORDS = {
    "시행",
    "수행",
    "실시",
    "확인",
    "점검",
    "중단",
    "중지",
    "측정",
    "계측",
    "투여",
    "투약",
    "주입",
    "준비",
    "구비",
    "기록",
    "기재",
    "작성",
    "채혈",
    "채취",
    "연결",
    "장착",
    "제거",
    "발관",
}
_CLAUSE_SPLIT = re.compile(r"[.!?。！？;,\n]+")


@dataclass(frozen=True)
class CoverageSlot:
    slot_id: str
    category: str
    supporting_source_unit_ids: tuple[str, ...]
    anchor_terms: tuple[str, ...]
    required_numeric_tokens: tuple[str, ...]
    required_action_families: tuple[str, ...]


@dataclass(frozen=True)
class CoveragePolicy:
    intent: str
    required_slots: tuple[CoverageSlot, ...]
    optional_source_unit_ids: tuple[str, ...]

    def to_dict(self) -> dict[str, Any]:
        return {
            "intent": self.intent,
            "required_slots": [asdict(slot) for slot in self.required_slots],
            "optional_source_unit_ids": list(self.optional_source_unit_ids),
        }

    def prompt_rows(self) -> tuple[dict[str, Any], ...]:
        return tuple(
            {
                "slot_id": slot.slot_id,
                "category": slot.category,
                "supporting_source_unit_ids": list(
                    slot.supporting_source_unit_ids
                ),
            }
            for slot in self.required_slots
        )


@dataclass(frozen=True)
class CoverageValidation:
    passed: bool
    error_code: str | None
    warnings: tuple[str, ...]


def _normalize_word(value: str) -> str:
    value = unicodedata.normalize("NFKC", value).casefold()
    for suffix in _PARTICLES:
        if value.endswith(suffix) and len(value) - len(suffix) >= 2:
            value = value[: -len(suffix)]
            break
    for suffix in _ENDINGS:
        if value.endswith(suffix) and len(value) - len(suffix) >= 2:
            value = value[: -len(suffix)]
            break
    return value


def _terms(text: str) -> tuple[str, ...]:
    values = []
    for raw in _WORD.findall(text):
        value = _normalize_word(raw)
        if (
            len(value) >= 2
            and not value.isdigit()
            and value not in _GENERIC
            and value not in _ACTION_WORDS
        ):
            values.append(value)
    return tuple(dict.fromkeys(values))


def _slot_for_unit(index: int, category: str, unit: SourceUnit) -> CoverageSlot:
    return CoverageSlot(
        slot_id=f"slot_{index:03d}",
        category=category,
        supporting_source_unit_ids=(unit.source_unit_id,),
        anchor_terms=_terms(unit.exact_text),
        required_numeric_tokens=tuple(
            sorted(_normalized_numeric_tokens(unit.exact_text))
        ),
        required_action_families=tuple(unit.action_families),
    )


def build_coverage_policy(
    *, intent: str, units: Sequence[SourceUnit], question: str = ""
) -> CoveragePolicy:
    """Build deterministic request-local requirements without raw diagnostics."""
    if not units:
        raise ValueError("invalid_evidence_catalog")
    if intent in {"procedure", "types"}:
        required = tuple(units)
        category = "step" if intent == "procedure" else "fact"
    else:
        question_terms = set(_terms(question))
        question_matched = tuple(
            unit
            for unit in units
            if question_terms.intersection(_terms(unit.exact_text))
        )
        explicitly_required = tuple(unit for unit in units if unit.required)
        required = question_matched or explicitly_required[:1] or (units[0],)
        category = "fact"
    required_ids = {unit.source_unit_id for unit in required}
    return CoveragePolicy(
        intent=intent,
        required_slots=tuple(
            _slot_for_unit(index, category, unit)
            for index, unit in enumerate(required, start=1)
        ),
        optional_source_unit_ids=tuple(
            unit.source_unit_id
            for unit in units
            if unit.source_unit_id not in required_ids
        ),
    )


def coverage_policy_from_dict(value: Mapping[str, Any]) -> CoveragePolicy:
    try:
        slots = tuple(
            CoverageSlot(
                slot_id=str(raw["slot_id"]),
                category=str(raw["category"]),
                supporting_source_unit_ids=tuple(
                    str(item) for item in raw["supporting_source_unit_ids"]
                ),
                anchor_terms=tuple(str(item) for item in raw["anchor_terms"]),
                required_numeric_tokens=tuple(
                    str(item) for item in raw["required_numeric_tokens"]
                ),
                required_action_families=tuple(
                    str(item) for item in raw["required_action_families"]
                ),
            )
            for raw in value["required_slots"]
        )
        optional = tuple(str(item) for item in value["optional_source_unit_ids"])
        intent = str(value["intent"])
    except (KeyError, TypeError, ValueError) as exc:
        raise ValueError("invalid_coverage_policy") from exc
    if not slots:
        raise ValueError("invalid_coverage_policy")
    return CoveragePolicy(intent, slots, optional)


def validate_required_coverage(
    *,
    policy: CoveragePolicy,
    candidate: Mapping[str, Any],
) -> CoverageValidation:
    statements = candidate.get("statements")
    if not isinstance(statements, list) or not statements:
        return CoverageValidation(False, "controlled_schema", ())
    cited_ids = {
        str(source_id)
        for statement in statements
        if isinstance(statement, Mapping)
        for source_id in statement.get("supporting_source_unit_ids", ())
    }
    for slot in policy.required_slots:
        supporting_statements = [
            statement
            for statement in statements
            if isinstance(statement, Mapping)
            and set(
                str(source_id)
                for source_id in statement.get("supporting_source_unit_ids", ())
            ).intersection(slot.supporting_source_unit_ids)
        ]
        if not supporting_statements:
            return CoverageValidation(False, "required_evidence_omitted", ())
        matched = False
        numeric_seen = False
        action_seen = False
        for statement in supporting_statements:
            text = str(statement.get("text") or "")
            statement_actions = set(_action_families(text))
            if slot.required_action_families and not set(
                slot.required_action_families
            ).intersection(statement_actions):
                continue
            action_seen = True
            clauses = tuple(
                clause.strip()
                for clause in _CLAUSE_SPLIT.split(text)
                if clause.strip()
            ) or (text,)
            for clause in clauses:
                clause_terms = set(_terms(clause))
                if slot.anchor_terms and not clause_terms.intersection(
                    slot.anchor_terms
                ):
                    continue
                clause_numbers = _normalized_numeric_tokens(clause)
                if not set(slot.required_numeric_tokens).issubset(clause_numbers):
                    continue
                numeric_seen = True
                matched = True
                break
            if matched:
                break
        if matched:
            continue
        if slot.required_action_families and not action_seen:
            return CoverageValidation(False, "required_action_omitted", ())
        if slot.required_numeric_tokens and not numeric_seen:
            return CoverageValidation(False, "required_clinical_token_omitted", ())
        return CoverageValidation(False, "required_evidence_omitted", ())
    warnings = ()
    if set(policy.optional_source_unit_ids) - cited_ids:
        warnings = ("optional_evidence_omitted",)
    return CoverageValidation(True, None, warnings)
