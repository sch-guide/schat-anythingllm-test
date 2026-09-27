from safety_evaluator.core import prepare_contract, validate_candidate


def _chunk(text: str, *, section: str = "수혈 안내"):
    return {
        "chunk_id": "chunk-1",
        "document_id": "doc-1",
        "document_name": "수혈간호지침.pdf",
        "page": 7,
        "section": section,
        "document_version": "2026-01",
        "rank": 1,
        "text": text,
    }


def _candidate(text: str, source_ids=("su001",)):
    return {
        "statements": [
            {"text": text, "supporting_source_unit_ids": list(source_ids)}
        ]
    }


def test_natural_word_order_change_passes():
    prepared = prepare_contract(
        request_id="natural-order",
        question="수혈 전에 무엇을 확인하나요?",
        retrieved_chunks=[_chunk("수혈 전 환자와 혈액제제를 반드시 확인한다.")],
    )

    result = validate_candidate(
        prepared,
        _candidate("반드시 혈액제제와 환자를 수혈 전에 확인합니다."),
    )

    assert result["decision"] == "PASS"


def test_execute_synonym_passes():
    prepared = prepare_contract(
        request_id="execute-synonym",
        question="어떤 검사를 시행하나요?",
        retrieved_chunks=[_chunk("필요한 검사를 시행한다.", section="검사")],
    )

    result = validate_candidate(prepared, _candidate("필요한 검사를 수행합니다."))

    assert result["decision"] == "PASS"


def test_equivalent_time_expression_passes():
    prepared = prepare_contract(
        request_id="time-expression",
        question="첫 15분 관찰 시간은 어떻게 되나요?",
        retrieved_chunks=[_chunk("첫 15분은 환자를 관찰한다.", section="수혈 관찰")],
    )

    result = validate_candidate(
        prepared,
        _candidate("첫 15분 동안은 환자를 관찰합니다."),
    )

    assert result["decision"] == "PASS"


def test_optional_surrounding_source_unit_can_be_omitted():
    prepared = prepare_contract(
        request_id="optional-evidence",
        question="수혈 목적은 무엇인가요?",
        retrieved_chunks=[_chunk("수혈 목적은 부족한 혈액 성분을 보충하는 것이다.")],
    )
    optional = dict(prepared["source_units"][0])
    optional.update(
        {
            "source_unit_id": "su002",
            "exact_text": "수혈 전 동의서를 확인한다.",
            "required": False,
            "source_order": (2, 1),
        }
    )
    prepared["source_units"].append(optional)
    prepared["coverage_policy"]["optional_source_unit_ids"] = ["su002"]

    result = validate_candidate(
        prepared,
        _candidate("수혈은 부족한 혈액 성분을 보충하기 위한 것입니다."),
    )

    assert result["decision"] == "PASS"
    assert "optional_evidence_omitted" in result["diagnostic"]["warnings"]


def test_required_type_item_omission_is_blocked():
    prepared = prepare_contract(
        request_id="missing-type",
        question="수혈 종류 알려줘",
        retrieved_chunks=[
            _chunk(
                "혈액 제제의 종류\n적혈구 제제\n혈소판 제제\n신선동결혈장",
                section="혈액 제제의 종류",
            )
        ],
    )

    result = validate_candidate(
        prepared,
        _candidate("적혈구 제제와 혈소판 제제가 있습니다.", ("su001", "su002")),
    )

    assert result["decision"] == "FAIL"
    assert result["error_code"] == "required_evidence_omitted"


def test_action_kind_and_strength_changes_remain_blocked():
    prepared = prepare_contract(
        request_id="action-risk",
        question="검사를 어떻게 하나요?",
        retrieved_chunks=[_chunk("검사를 반드시 시행한다.", section="검사")],
    )

    kind = validate_candidate(prepared, _candidate("검사를 반드시 확인합니다."))
    strength = validate_candidate(prepared, _candidate("검사를 권고합니다."))

    assert kind["decision"] == "FAIL"
    assert kind["error_code"] == "evaluation_action_kind_changed"
    assert strength["decision"] == "FAIL"
    assert strength["error_code"] in {
        "evaluation_action_kind_changed",
        "evaluation_action_strength_changed",
        "condition_changed",
        "required_action_omitted",
    }


def test_unknown_source_unit_remains_blocked():
    prepared = prepare_contract(
        request_id="unknown-source",
        question="무엇을 확인하나요?",
        retrieved_chunks=[_chunk("환자 정보를 확인한다.")],
    )

    result = validate_candidate(prepared, _candidate("환자 정보를 확인합니다.", ("su999",)))

    assert result["decision"] == "FAIL"
    assert result["error_code"] == "unknown_evidence_id"


def test_adult_and_pediatric_sources_cannot_be_cited_together():
    prepared = prepare_contract(
        request_id="branch-mix",
        question="진정 절차 알려줘",
        retrieved_chunks=[
            {
                **_chunk("진정 절차\n성인 환자를 확인한다.", section="성인 진정 절차"),
                "chunk_id": "adult",
                "rank": 1,
            },
            {
                **_chunk("진정 절차\n소아 환자를 확인한다.", section="소아 진정 절차"),
                "chunk_id": "pediatric",
                "rank": 1,
            },
        ],
    )

    result = validate_candidate(
        prepared,
        _candidate("성인과 소아 환자를 확인합니다.", ("su001", "su002")),
    )

    assert result["decision"] == "FAIL"
    assert result["error_code"] == "branch_mixing"


def test_numbers_cannot_be_swapped_between_products():
    prepared = prepare_contract(
        request_id="product-binding",
        question="A제제와 B제제의 투여량은?",
        retrieved_chunks=[
            _chunk(
                "A제제는 10 mg을 투여한다. B제제는 20 mg을 투여한다.",
                section="제제별 투여량",
            )
        ],
    )
    assert len(prepared["source_units"]) == 2

    result = validate_candidate(
        prepared,
        _candidate(
            "A제제는 20 mg을 투여하고, B제제는 10 mg을 투여합니다.",
            ("su001", "su002"),
        ),
    )

    assert result["decision"] == "FAIL"
    assert result["error_code"] == "required_clinical_token_omitted"
