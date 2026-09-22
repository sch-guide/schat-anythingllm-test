from safety_evaluator.core import prepare_contract


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
