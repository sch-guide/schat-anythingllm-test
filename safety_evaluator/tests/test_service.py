from safety_evaluator.service import route_request


def test_health_check_contains_no_sensitive_content():
    status, payload = route_request("GET", "/healthz", None)
    assert status == 200
    assert payload == {"status": "ok", "service": "schat-safety-evaluator"}


def test_invalid_payload_fails_closed_without_echoing_raw_text():
    status, payload = route_request(
        "POST",
        "/v1/prepare",
        {"request_id": "req-1", "question": "secret raw question", "retrieved_chunks": []},
    )
    assert status == 422
    assert payload["decision"] == "ERROR"
    assert payload["retry_count"] == 0
    assert "secret raw question" not in str(payload)


def test_unknown_endpoint_does_not_echo_request():
    status, payload = route_request("POST", "/unknown", {"text": "do not echo"})
    assert status == 404
    assert payload == {"error_code": "not_found", "retry_count": 0}
