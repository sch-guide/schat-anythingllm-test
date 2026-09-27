import pytest
from safety_evaluator.core import prepare_contract, validate_candidate


def _chunk(text: str, *, section: str = "지침"):
    return {
        "chunk_id": "chunk-1",
        "document_id": "doc-1",
        "document_name": "병원지침.pdf",
        "page": 7,
        "section": section,
        "document_version": "2026-01",
        "rank": 1,
        "text": text,
    }


@pytest.mark.parametrize(
    ("question", "text", "section", "expected_style", "prompt_marker"),
    [
        (
            "수혈 종류 알려줘",
            "혈액 제제의 종류\n적혈구 제제\n혈소판 제제",
            "혈액 제제의 종류",
            "list",
            "종류형 답변 규칙",
        ),
        (
            "수혈 절차 알려줘",
            "수혈 절차\n1. 환자를 확인한다.\n2. 혈액제제를 확인한다.",
            "수혈 절차",
            "numbered_steps",
            "절차형 답변 규칙",
        ),
        (
            "수혈 준비사항 알려줘",
            "수혈 전에 동의서를 확인한다.",
            "수혈 준비사항",
            "checklist",
            "준비형 답변 규칙",
        ),
        (
            "A 제제와 B 제제 차이 알려줘",
            "A 제제는 10 mg이다. B 제제는 20 mg이다.",
            "제제 비교",
            "comparison",
            "비교형 답변 규칙",
        ),
        (
            "수혈 목적을 설명해줘",
            "수혈은 부족한 혈액 성분을 보충하기 위한 것이다.",
            "수혈 목적",
            "explanation",
            "설명형 답변 규칙",
        ),
    ],
)
def test_prepare_contract_assigns_display_style_without_changing_safety_policy(
    question, text, section, expected_style, prompt_marker
):
    prepared = prepare_contract(
        request_id=f"style-{expected_style}",
        question=question,
        retrieved_chunks=[_chunk(text, section=section)],
    )

    assert prepared["answer_style"] == expected_style
    assert prompt_marker in prepared["generation_prompt"]
    assert prepared["retry_count"] == 0
    assert "coverage_policy" in prepared


def test_style_prompt_keeps_statement_text_free_of_markdown_formatting():
    prepared = prepare_contract(
        request_id="style-json-only",
        question="수혈 종류 알려줘",
        retrieved_chunks=[
            _chunk(
                "혈액 제제의 종류\n적혈구 제제\n혈소판 제제",
                section="혈액 제제의 종류",
            )
        ],
    )

    prompt = prepared["generation_prompt"]
    assert "statement text 안에 목록 기호" in prompt
    assert "직원 화면의 서식은 안전검사 통과 후 적용" in prompt


def test_style_prompt_preserves_high_risk_clinical_wording():
    prepared = prepare_contract(
        request_id="style-clinical-wording",
        question="수혈 절차 알려줘",
        retrieved_chunks=[
            _chunk("수혈 전 환자를 확인한다.", section="수혈 전 확인")
        ],
    )

    prompt = prepared["generation_prompt"]
    assert "행위 종류·강도" in prompt
    assert "불확실하면 원문 표현을 그대로" in prompt


def test_type_items_as_separate_plain_statements_pass_existing_safety_checks():
    prepared = prepare_contract(
        request_id="style-types-candidate",
        question="수혈 종류 알려줘",
        retrieved_chunks=[
            _chunk(
                "혈액 제제의 종류\n적혈구 제제\n혈소판 제제",
                section="혈액 제제의 종류",
            )
        ],
    )
    candidate = {
        "statements": [
            {"text": "적혈구 제제", "supporting_source_unit_ids": ["su001"]},
            {"text": "혈소판 제제", "supporting_source_unit_ids": ["su002"]},
        ]
    }

    result = validate_candidate(prepared, candidate)

    assert result["decision"] == "PASS"


def test_procedure_contract_can_carry_six_direct_workflow_steps_in_order():
    chunks = []
    sections = (
        "진정 처방 확인",
        "진정 사전 평가",
        "진정 시행 전 준비",
        "진정 시행",
        "진정 중 관찰",
        "진정 후 회복 기록",
    )
    for index, section in enumerate(sections, start=1):
        chunks.append(
            {
                **_chunk(f"{index}. {section}을 시행한다.", section=section),
                "chunk_id": f"chunk-{index}",
                "rank": index,
                "schat_procedure_workflow_continuation": index > 1,
            }
        )

    prepared = prepare_contract(
        request_id="style-long-procedure",
        question="진정 절차 알려줘",
        retrieved_chunks=chunks,
    )

    assert len(prepared["source_units"]) == 6
    assert [unit["source_order"][0] for unit in prepared["source_units"]] == [
        1,
        2,
        3,
        4,
        5,
        6,
    ]
    prompt = prepared["generation_prompt"]
    assert "직원이 실제 업무 흐름을 이해할 수 있을 정도로 충분히" in prompt
    assert "직접 관련된 SourceUnit을 빠뜨리지 않고" in prompt

    candidate = {
        "statements": [
            {
                "text": unit["exact_text"],
                "supporting_source_unit_ids": [unit["source_unit_id"]],
            }
            for unit in prepared["source_units"]
        ]
    }
    result = validate_candidate(prepared, candidate)
    assert result["decision"] == "PASS"


def test_procedure_candidate_with_an_unsupported_new_step_is_blocked():
    prepared = prepare_contract(
        request_id="style-unsupported-step",
        question="진정 절차 알려줘",
        retrieved_chunks=[
            _chunk("진정 전에 환자를 확인한다.", section="진정 전 확인")
        ],
    )
    candidate = {
        "statements": [
            {
                "text": "진정 전에 환자를 확인한다.",
                "supporting_source_unit_ids": ["su001"],
            },
            {
                "text": "진정 후 임의의 새 처치를 시행한다.",
                "supporting_source_unit_ids": ["su001"],
            },
        ]
    }

    result = validate_candidate(prepared, candidate)

    assert result["decision"] == "FAIL"


def test_procedure_contract_excludes_example_only_chunks_from_prompt_and_fallback():
    prepared = prepare_contract(
        request_id="style-procedure-examples",
        question="진정 절차 알려줘",
        retrieved_chunks=[
            _chunk("진정 전에 환자를 평가하고 확인한다.", section="진정 전 평가"),
            {
                **_chunk("진정 간호기록 예시 1 DPAR 기록을 입력한다.", section=""),
                "chunk_id": "chunk-example",
                "rank": 2,
                "schat_procedure_workflow_continuation": True,
            },
        ],
    )

    source_text = " ".join(
        unit["exact_text"] for unit in prepared["source_units"]
    )
    assert "예시" not in source_text
    assert "DPAR" not in source_text
    assert "예시" not in prepared["fallback"]["text"]
    assert "DPAR" not in prepared["generation_prompt"]


def test_procedure_prompt_allows_grounded_short_step_labels_without_markdown():
    prepared = prepare_contract(
        request_id="style-procedure-label",
        question="수혈 절차 알려줘",
        retrieved_chunks=[
            _chunk(
                "처방 및 동의 확인: 의사는 수혈 처방을 확인하고 동의서를 작성한다.",
                section="수혈 절차",
            )
        ],
    )

    assert "짧은 단계명: 설명" in prepared["generation_prompt"]
    candidate = {
        "statements": [
            {
                "text": prepared["source_units"][0]["exact_text"],
                "supporting_source_unit_ids": ["su001"],
            }
        ]
    }
    assert validate_candidate(prepared, candidate)["decision"] == "PASS"


def test_document_question_uses_list_presentation_style():
    prepared = prepare_contract(
        request_id="style-documents",
        question="전원 시 필요한 서류 알려줘",
        retrieved_chunks=[
            _chunk("전원 시 진료의뢰서를 준비한다.", section="전원 서류")
        ],
    )

    assert prepared["answer_style"] == "list"
