"""REST client for the TypeScript HTTP host (docs/http-api.md)."""

from __future__ import annotations

import json
import urllib.error
import urllib.request
from typing import Any


class HarnessError(Exception):
    """Non-2xx response from the host."""

    def __init__(self, status: int, body: Any) -> None:
        self.status = status
        self.body = body
        message = body.get("error") if isinstance(body, dict) else body
        super().__init__(f"HTTP {status}: {message}")


class HarnessClient:
    """Calls `GET /health`, `POST /api/sessions`, `POST /api/chat`, `GET /api/sessions/:id`."""

    def __init__(
        self,
        base_url: str = "http://127.0.0.1:8787",
        api_key: str | None = None,
        timeout: float = 120,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key
        self.timeout = timeout

    def health(self) -> dict[str, Any]:
        return self._request("GET", "/health")

    def create_session(self, session_id: str | None = None) -> dict[str, Any]:
        body: dict[str, Any] = {}
        if session_id is not None:
            body["sessionId"] = session_id
        return self._request("POST", "/api/sessions", body)

    def admit(
        self,
        session_id: str,
        message: str,
        delivery: str | None = None,
    ) -> dict[str, Any]:
        body: dict[str, Any] = {"message": message}
        if delivery is not None:
            body["delivery"] = delivery
        return self._request("POST", f"/api/sessions/{session_id}/admit", body)

    def turn(self, session_id: str, message: str | None = None) -> dict[str, Any]:
        body: dict[str, Any] = {}
        if message is not None:
            body["message"] = message
        return self._request("POST", f"/api/sessions/{session_id}/turn", body)

    def chat(self, message: str, session_id: str | None = None) -> dict[str, Any]:
        body: dict[str, Any] = {"message": message}
        if session_id is not None:
            body["sessionId"] = session_id
        return self._request("POST", "/api/chat", body)

    def get_session(self, session_id: str) -> dict[str, Any]:
        return self._request("GET", f"/api/sessions/{session_id}")

    def chat_stream(
        self,
        message: str,
        session_id: str | None = None,
    ) -> list[dict[str, Any]]:
        """Read `POST /api/chat/stream` SSE (`session`, `session_event`, `done`)."""
        body: dict[str, Any] = {"message": message}
        if session_id is not None:
            body["sessionId"] = session_id
        data = json.dumps(body).encode("utf-8")
        headers = {
            "Accept": "text/event-stream",
            "Content-Type": "application/json",
        }
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"
        request = urllib.request.Request(
            f"{self.base_url}/api/chat/stream",
            data=data,
            headers=headers,
            method="POST",
        )
        try:
            with urllib.request.urlopen(request, timeout=self.timeout) as response:
                raw = response.read().decode("utf-8")
        except urllib.error.HTTPError as err:
            raw = err.read().decode("utf-8")
            raise HarnessError(err.code, _decode(raw)) from err
        return _parse_sse(raw)

    def _request(
        self,
        method: str,
        path: str,
        body: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        data = None if body is None else json.dumps(body).encode("utf-8")
        headers = {"Accept": "application/json"}
        if data is not None:
            headers["Content-Type"] = "application/json"
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"
        request = urllib.request.Request(
            self.base_url + path,
            data=data,
            headers=headers,
            method=method,
        )
        try:
            with urllib.request.urlopen(request, timeout=self.timeout) as response:
                raw = response.read().decode("utf-8")
        except urllib.error.HTTPError as err:
            raw = err.read().decode("utf-8")
            raise HarnessError(err.code, _decode(raw)) from err
        parsed = _decode(raw)
        if not isinstance(parsed, dict):
            raise HarnessError(200, parsed)
        return parsed


def _decode(raw: str) -> Any:
    if not raw:
        return {}
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        return raw


def _parse_sse(raw: str) -> list[dict[str, Any]]:
    events: list[dict[str, Any]] = []
    event = "message"
    data_lines: list[str] = []

    def flush() -> None:
        nonlocal event, data_lines
        if not data_lines:
            event = "message"
            return
        payload = _decode("\n".join(data_lines))
        row = payload if isinstance(payload, dict) else {"data": payload}
        events.append({"event": event, **row})
        event = "message"
        data_lines = []

    for line in raw.splitlines():
        if line == "":
            flush()
            continue
        if line.startswith(":"):
            continue
        if line.startswith("event:"):
            event = line[6:].strip() or "message"
            continue
        if line.startswith("data:"):
            data_lines.append(line[5:].lstrip())
    flush()
    return events
