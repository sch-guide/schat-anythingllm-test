from safety_evaluator.core import prepare_contract, validate_candidate


def chunks(text: str):
    return [
        {
            "chunk_id": "chunk-1",
            "document_id": "doc-1",
            "document_name": "수혈간호지침.pdf",
            "page": 7,
            "section": "수혈 시행 전 확인사항",
            "document_version": "2026-01",
            "rank": 1,
            "text": text,
        }
    ]


def candidate(text: str):
    return {
        "statements": [
            {"text": text, "supporting_source_unit_ids": ["su001"]}
        ]
    }


def test_prepare_contract_preserves_source_metadata_and_builds_fallback():
    prepared = prepare_contract(
        request_id="req-1",
        question="수혈 전에 무엇을 해야 하나요?",
        retrieved_chunks=chunks("수혈 전 환자와 혈액제제를 반드시 확인한다."),
    )

    assert prepared["source_units"][0]["chunk_id"] == "chunk-1"
    assert prepared["display_sources"] == [
        {
            "document_name": "수혈간호지침.pdf",
            "page": 7,
            "section": "수혈 시행 전 확인사항",
        }
    ]
    assert "수혈 전 환자와 혈액제제를 반드시 확인한다." in prepared["fallback"]["text"]
    assert "chunk-1" not in prepared["fallback"]["text"]


def test_safe_candidate_passes_and_is_returned_for_display():
    prepared = prepare_contract(
        request_id="req-1",
        question="수혈 전에 무엇을 해야 하나요?",
        retrieved_chunks=chunks("수혈 전 환자와 혈액제제를 반드시 확인한다."),
    )

    result = validate_candidate(prepared, candidate("수혈 전 환자와 혈액제제를 반드시 확인한다."))

    assert result["decision"] == "PASS"
    assert result["display_output"]["kind"] == "candidate"
    assert result["retry_count"] == 0


def test_action_kind_change_falls_back():
    prepared = prepare_contract(
        request_id="req-1",
        question="무엇을 시행하나요?",
        retrieved_chunks=chunks("검사를 반드시 시행한다."),
    )

    result = validate_candidate(prepared, candidate("검사를 반드시 확인한다."))

    assert result["decision"] == "FAIL"
    assert result["error_code"] == "evaluation_action_kind_changed"
    assert result["display_output"]["kind"] == "extractive_fallback"


def test_action_strength_change_falls_back():
    prepared = prepare_contract(
        request_id="req-1",
        question="언제 중단하나요?",
        retrieved_chunks=chunks("이상이 나타나면 즉시 투여를 중단한다."),
    )

    result = validate_candidate(prepared, candidate("이상이 나타나면 투여 중단을 고려한다."))

    assert result["decision"] == "FAIL"
    assert result["error_code"] == "evaluation_action_strength_changed"


def test_number_or_speed_change_falls_back():
    prepared = prepare_contract(
        request_id="req-1",
        question="주입 속도는 얼마인가요?",
        retrieved_chunks=chunks("수액은 50 mL/hr 속도로 주입한다."),
    )

    result = validate_candidate(prepared, candidate("수액은 80 mL/hr 속도로 주입한다."))

    assert result["decision"] == "FAIL"
    assert result["error_code"] == "unsupported_number_or_unit"


def test_unit_change_falls_back():
    prepared = prepare_contract(
        request_id="req-1",
        question="투여량은 얼마인가요?",
        retrieved_chunks=chunks("약물 50 mg을 투여한다."),
    )

    result = validate_candidate(prepared, candidate("약물 50 mL를 투여한다."))

    assert result["decision"] == "FAIL"
    assert result["error_code"] == "unsupported_number_or_unit"


def test_required_time_omission_falls_back():
    prepared = prepare_contract(
        request_id="req-1",
        question="관찰 시간은 얼마인가요?",
        retrieved_chunks=chunks("투여 후 15분 동안 환자를 관찰한다."),
    )

    result = validate_candidate(prepared, candidate("투여 후 환자를 관찰한다."))

    assert result["decision"] == "FAIL"
    assert result["error_code"] == "required_clinical_token_omitted"


def test_condition_change_falls_back():
    prepared = prepare_contract(
        request_id="req-1",
        question="언제 중단하나요?",
        retrieved_chunks=chunks("발열이 있으면 투여를 중단한다."),
    )

    result = validate_candidate(prepared, candidate("항상 투여를 중단한다."))

    assert result["decision"] == "FAIL"
    assert result["error_code"] == "condition_changed"


def test_exception_omission_falls_back():
    prepared = prepare_contract(
        request_id="req-1",
        question="예외는 무엇인가요?",
        retrieved_chunks=chunks("응급상황을 제외하고 검사를 시행한다."),
    )

    result = validate_candidate(prepared, candidate("검사를 시행한다."))

    assert result["decision"] == "FAIL"
    assert result["error_code"] == "condition_changed"


def test_prohibition_weakened_to_caution_falls_back():
    prepared = prepare_contract(
        request_id="req-1",
        question="금기 사항은 무엇인가요?",
        retrieved_chunks=chunks("이 약물의 투여는 금지한다."),
    )

    result = validate_candidate(prepared, candidate("이 약물의 투여에 주의한다."))

    assert result["decision"] == "FAIL"
    assert result["error_code"] in {
        "evaluation_action_kind_changed",
        "evaluation_action_strength_changed",
        "negation_changed",
        "prohibition_weakened",
    }


def test_unknown_source_unit_falls_back_without_raw_diagnostics():
    prepared = prepare_contract(
        request_id="req-1",
        question="무엇을 확인하나요?",
        retrieved_chunks=chunks("환자 정보를 확인한다."),
    )
    bad = {
        "statements": [
            {"text": "환자 정보를 확인한다.", "supporting_source_unit_ids": ["su999"]}
        ]
    }

    result = validate_candidate(prepared, bad)

    assert result["decision"] == "FAIL"
    assert result["retry_count"] == 0
    assert "환자 정보를 확인한다." not in str(result["diagnostic"])
