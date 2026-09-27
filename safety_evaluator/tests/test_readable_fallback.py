import pytest
from safety_evaluator.core import SafetyContractError, prepare_contract


def _chunks(text: str):
    return [
        {
            "chunk_id": "chunk-1",
            "document_id": "doc-1",
            "document_name": "진정간호.pdf",
            "page": 7,
            "section": "진정 절차",
            "document_version": "2026-01",
            "rank": 1,
            "text": text,
        }
    ]


def test_prepare_contract_removes_technical_wrappers_and_selects_question_evidence():
    prepared = prepare_contract(
        request_id="req-clean",
        question="진정 절차를 알려줘",
        retrieved_chunks=_chunks(
            "<document_metadata>title: 진정간호.pdf</document_metadata>\n"
            "목적은 안전한 진정을 제공하는 것이다.\n"
            "진정 절차는 환자 확인 후 활력징후를 측정한다.\n"
            "<svg><text>internal diagram</text></svg>"
        ),
    )
    fallback = prepared["fallback"]["text"]
    assert "진정 절차" in fallback
    assert "document_metadata" not in fallback
    assert "svg" not in fallback.lower()
    assert "목적은" not in fallback
    assert len(prepared["source_units"]) < 3


def test_prompt_requires_only_directly_relevant_selected_evidence():
    prepared = prepare_contract(
        request_id="req-prompt",
        question="소아 진정 알려줘",
        retrieved_chunks=_chunks("소아 진정은 대상 기준을 확인한 뒤 시행한다."),
    )
    assert "질문에 직접 필요한" in prepared["generation_prompt"]
    assert "선택된 SourceUnit" in prepared["generation_prompt"]


def test_fallback_selects_only_the_best_question_related_sentences_globally():
    prepared = prepare_contract(
        request_id="req-transfusion-types",
        question="수혈 종류 알려줘",
        retrieved_chunks=[
            {
                "chunk_id": "types",
                "document_id": "guide",
                "document_name": "수혈간호.pdf",
                "page": 114,
                "section": "혈액 제제의 종류",
                "rank": 1,
                "text": "수혈 종류는 적혈구 제제, 혈소판 제제, 신선동결혈장이다.",
            },
            {
                "chunk_id": "procedure",
                "document_id": "guide",
                "document_name": "수혈간호.pdf",
                "page": 117,
                "section": "수혈 절차",
                "rank": 2,
                "text": "수혈 전 동의서를 확인한다. 수혈 직전 환자를 확인한다.",
            },
        ],
    )

    fallback = prepared["fallback"]["text"]
    assert "적혈구 제제" in fallback
    assert "동의서" not in fallback
    assert "환자를 확인" not in fallback
    assert len(prepared["source_units"]) == 1


def test_single_unrelated_sentence_does_not_become_fallback_evidence():
    with pytest.raises(SafetyContractError, match="no_source_units"):
        prepare_contract(
            request_id="req-missing-term",
            question="비터널형 카테터는 뭐야?",
            retrieved_chunks=[
                {
                    "chunk_id": "unrelated",
                    "document_id": "guide",
                    "document_name": "배액관.pdf",
                    "page": 154,
                    "section": "배액관 관리",
                    "rank": 1,
                    "text": "신장에서 소변 배출이 어려운 경우 배액관을 삽입한다.",
                }
            ],
        )


def test_procedure_contract_keeps_ordered_steps_after_a_heading_anchor():
    prepared = prepare_contract(
        request_id="req-procedure-steps",
        question="진정 절차",
        retrieved_chunks=_chunks(
            "진정 절차\n"
            "1. 환자를 확인한다.\n"
            "2. 진정 전 활력징후를 측정한다.\n"
            "3. 시행 내용을 기록한다.\n"
            "진정의 목적\n"
            "환자의 불안을 감소시키기 위한 설명이다."
        ),
    )

    evidence = [unit["exact_text"] for unit in prepared["source_units"]]
    assert evidence == [
        "1. 환자를 확인한다.",
        "2. 진정 전 활력징후를 측정한다.",
        "3. 시행 내용을 기록한다.",
    ]
    prompt = prepared["generation_prompt"]
    assert "모든 필수 단계" in prompt
    assert "원문 순서" in prompt
    assert "서로 다른 대상·분기" in prompt


def test_types_contract_keeps_type_rows_after_heading_and_stops_at_next_section():
    prepared = prepare_contract(
        request_id="req-types-rows",
        question="수혈 종류 알려줘",
        retrieved_chunks=[
            {
                "chunk_id": "types",
                "document_id": "guide",
                "document_name": "수혈간호.pdf",
                "page": 113,
                "section": "혈액 제제",
                "rank": 1,
                "text": (
                    "3. 혈액 제제의 종류\n"
                    "적혈구 제제\n"
                    "혈소판 제제\n"
                    "신선동결혈장\n"
                    "수혈 요법의 목적\n"
                    "혈액의 결핍 성분을 보충한다."
                ),
            }
        ],
    )

    evidence = [unit["exact_text"] for unit in prepared["source_units"]]
    assert evidence == ["적혈구 제제", "혈소판 제제", "신선동결혈장"]
    assert "목적" not in prepared["fallback"]["text"]


def test_types_contract_formats_verified_flattened_table_as_readable_list():
    prepared = prepare_contract(
        request_id="req-types-flat-table",
        question="수혈 종류 알려줘",
        retrieved_chunks=[
            {
                "chunk_id": "types-flat",
                "document_id": "guide",
                "document_name": "수혈간호.pdf",
                "page": 114,
                "section": "혈액 제제의 종류",
                "rank": 1,
                "text": (
                    "- 238 -\n"
                    "종류\n"
                    "적혈구 제제혈소판 제제신선동결혈장동결침전제제\n"
                    "RBC\nPLT\nPLTP\nFFP\nCRYO\n"
                    "목적\n혈액 성분을 보충한다."
                ),
            }
        ],
    )

    assert prepared["fallback"]["text"] == (
        "- 적혈구 제제\n"
        "- 혈소판 제제\n"
        "- 신선동결혈장\n"
        "- 동결침전제제"
    )
    assert "238" not in prepared["fallback"]["text"]
    assert "목적" not in prepared["fallback"]["text"]
    assert prepared["display_sources"] == [
        {
            "document_name": "수혈간호.pdf",
            "page": 114,
            "section": "혈액 제제의 종류",
        }
    ]


def test_generic_procedure_uses_the_highest_ranked_branch_instead_of_mixing_lower_branch():
    prepared = prepare_contract(
        request_id="req-ranked-procedure",
        question="진정 절차",
        retrieved_chunks=[
            {
                "chunk_id": "common",
                "document_id": "guide",
                "document_name": "진정간호.pdf",
                "page": 160,
                "section": "진정 전 확인 방법",
                "rank": 1,
                "text": (
                    "진정 절차\n"
                    "1. 환자 평가서를 확인한다.\n"
                    "2. 활력징후를 확인한다."
                ),
            },
            {
                "chunk_id": "pediatric",
                "document_id": "guide",
                "document_name": "진정간호.pdf",
                "page": 166,
                "section": "소아 진정치료 절차",
                "rank": 2,
                "text": (
                    "소아 진정치료 절차\n"
                    "1. 보호자 동행 여부를 확인한다."
                ),
            },
        ],
    )

    evidence = [unit["exact_text"] for unit in prepared["source_units"]]
    assert evidence == [
        "1. 환자 평가서를 확인한다.",
        "2. 활력징후를 확인한다.",
    ]
    assert "보호자" not in prepared["fallback"]["text"]


def test_procedure_contract_includes_only_marked_same_document_workflow_continuation():
    prepared = prepare_contract(
        request_id="req-procedure-workflow",
        question="진정 절차",
        retrieved_chunks=[
            {
                "chunk_id": "before",
                "document_id": "guide",
                "document_name": "진정간호.pdf",
                "page": 160,
                "section": "진정 전 환자평가서 확인 방법",
                "rank": 1,
                "text": "진정 QSED 처방을 확인한다.",
            },
            {
                "chunk_id": "record",
                "document_id": "guide",
                "document_name": "진정간호.pdf",
                "page": 161,
                "section": "진정 중 서면 기록지 출력 방법",
                "rank": 2,
                "schat_procedure_workflow_continuation": True,
                "text": "진정 중 기록지를 출력하고 내용을 기록한다.",
            },
            {
                "chunk_id": "pediatric",
                "document_id": "guide",
                "document_name": "진정간호.pdf",
                "page": 166,
                "section": "소아 진정치료 절차",
                "rank": 3,
                "text": "소아 보호자 동행 여부를 확인한다.",
            },
        ],
    )

    evidence = [unit["exact_text"] for unit in prepared["source_units"]]
    assert evidence == [
        "진정 QSED 처방을 확인한다.",
        "진정 중 기록지를 출력하고 내용을 기록한다.",
    ]
    assert prepared["display_sources"] == [
        {
            "document_name": "진정간호.pdf",
            "page": 160,
            "section": "진정 전 환자평가서 확인 방법",
        },
        {
            "document_name": "진정간호.pdf",
            "page": 161,
            "section": "진정 중 서면 기록지 출력 방법",
        },
    ]


def test_types_contract_skips_a_heading_only_chunk_and_uses_its_continuation():
    prepared = prepare_contract(
        request_id="req-split-types",
        question="수혈 종류 알려줘",
        retrieved_chunks=[
            {
                "chunk_id": "heading",
                "document_id": "guide",
                "document_name": "수혈간호.pdf",
                "page": 113,
                "section": "혈액 제제의 종류",
                "rank": 1,
                "text": "수혈 요법의 목적\n3. 혈액 제제의 종류",
            },
            {
                "chunk_id": "continuation",
                "document_id": "guide",
                "document_name": "수혈간호.pdf",
                "page": 114,
                "section": "혈액 제제의 종류",
                "rank": 2,
                "text": "종류\n적혈구 제제\n혈소판 제제\n신선동결혈장",
            },
        ],
    )

    evidence = [unit["exact_text"] for unit in prepared["source_units"]]
    assert evidence == ["적혈구 제제", "혈소판 제제", "신선동결혈장"]
    assert prepared["display_sources"] == [
        {
            "document_name": "수혈간호.pdf",
            "page": 114,
            "section": "혈액 제제의 종류",
        }
    ]


def test_procedure_sequence_stops_before_short_branch_headers():
    prepared = prepare_contract(
        request_id="req-procedure-branch",
        question="진정 절차",
        retrieved_chunks=_chunks(
            "진정 절차\n"
            "1. 진정 처방을 확인한다.\n"
            "성인\n"
            "2. 성인용 절차를 시행한다.\n"
            "소아\n"
            "2. 소아용 절차를 시행한다."
        ),
    )

    evidence = [unit["exact_text"] for unit in prepared["source_units"]]
    assert evidence == ["1. 진정 처방을 확인한다."]
