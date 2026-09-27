from safety_evaluator.table_evidence import extract_verified_table_items


def test_extracts_only_explicit_rows_between_table_headers():
    text = (
        "- 238 -\n"
        "종류\n"
        "적혈구 제제\n"
        "혈소판 제제\n"
        "신선동결혈장\n"
        "동결침전제제\n"
        "목적\n"
        "혈액 성분을 보충한다."
    )

    result = extract_verified_table_items(
        text,
        question="수혈 종류 알려줘",
        section="혈액 제제의 종류",
    )

    assert result == (
        "적혈구 제제",
        "혈소판 제제",
        "신선동결혈장",
        "동결침전제제",
    )


def test_splits_a_flattened_type_row_only_when_suffix_boundaries_round_trip():
    text = "종류\n적혈구 제제혈소판 제제신선동결혈장동결침전제제\n목적\n..."

    result = extract_verified_table_items(
        text,
        question="수혈 종류 알려줘",
        section="혈액 제제의 종류",
    )

    assert result == (
        "적혈구 제제",
        "혈소판 제제",
        "신선동결혈장",
        "동결침전제제",
    )


def test_does_not_guess_an_ambiguous_flattened_row_without_verified_boundaries():
    result = extract_verified_table_items(
        "종류\n가나다라마바사아자차\n목적\n...",
        question="종류 알려줘",
        section="종류",
    )

    assert result == ()


def test_ignores_page_markers_and_technical_wrappers():
    text = (
        "<document_metadata>internal</document_metadata>\n"
        "<svg>hidden</svg>\n"
        "종류\n적혈구 제제\n혈소판 제제\n목적\n- 238 -"
    )

    result = extract_verified_table_items(
        text,
        question="수혈 종류 알려줘",
        section="혈액 제제의 종류",
    )

    assert result == ("적혈구 제제", "혈소판 제제")
