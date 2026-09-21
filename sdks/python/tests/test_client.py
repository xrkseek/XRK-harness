import json
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from xrk_harness import HarnessClient, HarnessError


class Handler(BaseHTTPRequestHandler):
    def log_message(self, _format: str, *_args: object) -> None:
        return

    def _json(self, code: int, payload: object) -> None:
        raw = json.dumps(payload).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def _body(self) -> dict:
        length = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(length) if length else b""
        return json.loads(raw) if raw else {}

    def _authed(self) -> bool:
        return self.headers.get("Authorization") == "Bearer test-key"

    def do_GET(self) -> None:
        if self.path == "/health":
            self._json(200, {"ok": True})
            return
        if not self._authed():
            self._json(401, {"error": "unauthorized"})
            return
        if self.path == "/api/sessions/sess_1":
            self._json(200, {"sessionId": "sess_1", "events": []})
            return
        self._json(404, {"error": "not found"})

    def do_POST(self) -> None:
        body = self._body()
        if not self._authed():
            self._json(401, {"error": "unauthorized"})
            return
        if self.path == "/api/sessions":
            self._json(201, {"sessionId": body.get("sessionId") or "sess_new"})
            return
        if self.path == "/api/chat":
            if body.get("message") == "busy":
                self._json(409, {"error": "session busy"})
                return
            self._json(
                200,
                {
                    "sessionId": body.get("sessionId") or "sess_new",
                    "turnId": "turn_1",
                    "text": "pong",
                    "steps": 1,
                },
            )
            return
        if self.path == "/api/sessions/sess_1/admit":
            self._json(202, {"sessionId": "sess_1", "admitId": "a1", "delivery": body.get("delivery") or "queue"})
            return
        if self.path == "/api/sessions/sess_1/turn":
            self._json(200, {"sessionId": "sess_1", "turnId": "turn_2", "text": body.get("message") or "promoted", "steps": 1})
            return
        if self.path == "/api/chat/stream":
            raw = (
                "event: session\ndata: {\"sessionId\": \"sess_1\"}\n\n"
                "event: done\ndata: {\"text\": \"pong\"}\n\n"
            ).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.send_header("Content-Length", str(len(raw)))
            self.end_headers()
            self.wfile.write(raw)
            return
        self._json(404, {"error": "not found"})


class ClientTest(unittest.TestCase):
    def setUp(self) -> None:
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        host, port = self.server.server_address[:2]
        self.client = HarnessClient(f"http://{host}:{port}", api_key="test-key", timeout=5)

    def tearDown(self) -> None:
        self.server.shutdown()
        self.thread.join(timeout=2)

    def test_health_session_and_chat(self) -> None:
        self.assertEqual(self.client.health(), {"ok": True})
        created = self.client.create_session("sess_1")
        self.assertEqual(created["sessionId"], "sess_1")
        result = self.client.chat("ping", session_id="sess_1")
        self.assertEqual(result["text"], "pong")
        self.assertEqual(self.client.get_session("sess_1")["events"], [])

    def test_admit_turn_and_stream(self) -> None:
        admitted = self.client.admit("sess_1", "later", delivery="queue")
        self.assertEqual(admitted["admitId"], "a1")
        turned = self.client.turn("sess_1")
        self.assertEqual(turned["text"], "promoted")
        events = self.client.chat_stream("ping", session_id="sess_1")
        self.assertEqual(events[0]["event"], "session")
        self.assertEqual(events[1]["text"], "pong")

    def test_busy_is_an_error(self) -> None:
        with self.assertRaises(HarnessError) as caught:
            self.client.chat("busy")
        self.assertEqual(caught.exception.status, 409)


if __name__ == "__main__":
    unittest.main()
