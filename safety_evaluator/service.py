"""Internal-only HTTP boundary for the SCHAT Python safety validators."""

from __future__ import annotations

import json
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any, Mapping

from safety_evaluator.core import SafetyContractError, prepare_contract, validate_candidate

MAX_BODY_BYTES = 256 * 1024


def _safe_error(code: str) -> dict[str, Any]:
    return {
        "decision": "ERROR",
        "fallback_to_extractive": True,
        "retry_count": 0,
        "error_code": code,
    }


def route_request(method: str, path: str, payload: Mapping[str, Any] | None):
    if method == "GET" and path == "/healthz":
        return 200, {"status": "ok", "service": "schat-safety-evaluator"}
    if method != "POST" or path not in {"/v1/prepare", "/v1/validate"}:
        return 404, {"error_code": "not_found", "retry_count": 0}
    if not isinstance(payload, Mapping):
        return 400, _safe_error("invalid_json")
    try:
        if path == "/v1/prepare":
            result = prepare_contract(
                request_id=payload.get("request_id"),
                question=payload.get("question"),
                retrieved_chunks=payload.get("retrieved_chunks"),
            )
            return 200, result
        prepared = payload.get("prepared")
        candidate = payload.get("candidate")
        if not isinstance(prepared, Mapping) or not isinstance(candidate, Mapping):
            raise SafetyContractError("invalid_validation_payload")
        return 200, validate_candidate(prepared, candidate)
    except (SafetyContractError, TypeError, ValueError, KeyError):
        return 422, _safe_error("safety_contract_rejected")
    except Exception:
        return 500, _safe_error("safety_evaluator_internal")


class SafetyHandler(BaseHTTPRequestHandler):
    server_version = "SCHATSafety/1"

    def log_message(self, _format, *_args):
        # Never write request paths, source text, candidate text, or bodies.
        return

    def _write(self, status: int, payload: Mapping[str, Any]):
        content = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(content)))
        self.end_headers()
        self.wfile.write(content)

    def do_GET(self):
        status, payload = route_request("GET", self.path, None)
        self._write(status, payload)

    def do_POST(self):
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            length = 0
        if length <= 0 or length > MAX_BODY_BYTES:
            self._write(413, _safe_error("request_size"))
            return
        try:
            body = json.loads(self.rfile.read(length))
        except (json.JSONDecodeError, UnicodeDecodeError):
            self._write(400, _safe_error("invalid_json"))
            return
        status, payload = route_request("POST", self.path, body)
        self._write(status, payload)


def main():
    host = os.getenv("SCHAT_SAFETY_HOST", "0.0.0.0")
    port = int(os.getenv("SCHAT_SAFETY_PORT", "8001"))
    ThreadingHTTPServer((host, port), SafetyHandler).serve_forever()


if __name__ == "__main__":
    main()
