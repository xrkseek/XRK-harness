"""Newline JSON-RPC client that spawns the TypeScript `xrkh acp` host.

The agent loop stays in that process. This module only speaks the existing
stdio ACP wire (`initialize`, `session/new`, `session/prompt`).
"""

from __future__ import annotations

import json
import subprocess
import threading
from collections import deque
from typing import Any


class StdioHarnessError(Exception):
    """JSON-RPC or transport failure talking to `xrkh acp`."""

    def __init__(self, message: str, code: int | None = None) -> None:
        self.code = code
        super().__init__(message)


class StdioHarnessClient:
    """Spawn `xrkh acp` and run one turn over stdio JSON-RPC.

    HTTP `HarnessClient` is unchanged. Pass `command` in tests to point at a
    fake runtime; the default argv is `xrkh acp`.
    """

    def __init__(
        self,
        command: list[str] | None = None,
        *,
        cwd: str | None = None,
        timeout: float = 120,
        env: dict[str, str] | None = None,
    ) -> None:
        self.command = command or ["xrkh", "acp"]
        self.cwd = cwd
        self.timeout = timeout
        self.env = env
        self._proc: subprocess.Popen[str] | None = None
        self._next_id = 0
        self._lock = threading.Lock()
        self._write_lock = threading.Lock()
        self._waiters: dict[int, threading.Event] = {}
        self._results: dict[int, dict[str, Any]] = {}
        self._notes: list[dict[str, Any]] = []
        self._stderr: deque[str] = deque(maxlen=40)
        self._reader: threading.Thread | None = None
        self._stderr_thread: threading.Thread | None = None
        self._initialized = False
        self._session_id: str | None = None

    def __enter__(self) -> "StdioHarnessClient":
        self.start()
        return self

    def __exit__(self, _exc_type: object, _exc: object, _tb: object) -> None:
        self.close()

    def start(self) -> None:
        if self._proc is not None:
            return
        self._proc = subprocess.Popen(
            self.command,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            encoding="utf-8",
            cwd=self.cwd,
            env=self.env,
            bufsize=1,
        )
        self._reader = threading.Thread(target=self._read_stdout, daemon=True)
        self._reader.start()
        self._stderr_thread = threading.Thread(target=self._read_stderr, daemon=True)
        self._stderr_thread.start()

    def close(self) -> None:
        proc = self._proc
        if proc is None:
            return
        if proc.stdin:
            try:
                proc.stdin.close()
            except OSError:
                pass
        try:
            proc.wait(timeout=2)
        except subprocess.TimeoutExpired:
            proc.terminate()
            try:
                proc.wait(timeout=2)
            except subprocess.TimeoutExpired:
                proc.kill()
                proc.wait(timeout=2)
        for stream in (proc.stdout, proc.stderr):
            if stream is None:
                continue
            try:
                stream.close()
            except OSError:
                pass
        self._proc = None
        self._fail_waiters("xrkh stdio closed")

    def initialize(self) -> dict[str, Any]:
        self.start()
        result = self._request("initialize", {})
        self._initialized = True
        return result

    def new_session(self, cwd: str | None = None) -> str:
        self.start()
        result = self._request("session/new", {"cwd": cwd or self.cwd or "."})
        session_id = result.get("sessionId")
        if not isinstance(session_id, str) or not session_id:
            raise StdioHarnessError("session/new did not return sessionId")
        self._session_id = session_id
        return session_id

    def prompt(self, session_id: str, text: str) -> dict[str, Any]:
        """One `session/prompt` turn. `text` is the joined agent_message chunks."""
        self.start()
        note_from = len(self._notes)
        result = self._request(
            "session/prompt",
            {
                "sessionId": session_id,
                "prompt": [{"type": "text", "text": text}],
            },
        )
        chunks: list[str] = []
        for note in self._notes[note_from:]:
            if note.get("method") != "session/update":
                continue
            params = note.get("params")
            if not isinstance(params, dict):
                continue
            update = params.get("update")
            if not isinstance(update, dict):
                continue
            if update.get("sessionUpdate") != "agent_message_chunk":
                continue
            content = update.get("content")
            if isinstance(content, dict) and isinstance(content.get("text"), str):
                chunks.append(content["text"])
        stop = result.get("stopReason")
        return {
            "sessionId": session_id,
            "stopReason": stop if isinstance(stop, str) else None,
            "text": "".join(chunks),
        }

    def run(self, text: str, *, cwd: str | None = None) -> dict[str, Any]:
        """initialize (once) + session/new (once) + session/prompt."""
        self.start()
        if not self._initialized:
            self.initialize()
        if self._session_id is None:
            self.new_session(cwd)
        return self.prompt(self._session_id, text)

    def _request(self, method: str, params: dict[str, Any]) -> dict[str, Any]:
        proc = self._proc
        if proc is None or proc.stdin is None:
            raise StdioHarnessError("xrkh stdio is not running")
        with self._lock:
            self._next_id += 1
            request_id = self._next_id
            event = threading.Event()
            self._waiters[request_id] = event
        frame = {
            "jsonrpc": "2.0",
            "id": request_id,
            "method": method,
            "params": params,
        }
        payload = json.dumps(frame, separators=(",", ":")) + "\n"
        try:
            with self._write_lock:
                proc.stdin.write(payload)
                proc.stdin.flush()
        except OSError as err:
            self._waiters.pop(request_id, None)
            raise StdioHarnessError(f"failed to write {method}: {err}") from err
        if not event.wait(self.timeout):
            self._waiters.pop(request_id, None)
            tail = " ".join(self._stderr).strip()
            extra = f" stderr: {tail}" if tail else ""
            raise StdioHarnessError(f"{method} timed out{extra}")
        message = self._results.pop(request_id, None)
        self._waiters.pop(request_id, None)
        if message is None:
            raise StdioHarnessError(f"{method} failed: xrkh stdio closed")
        if "error" in message:
            error = message["error"]
            if isinstance(error, dict):
                code = error.get("code")
                text = str(error.get("message") or error)
                raise StdioHarnessError(
                    text,
                    code if isinstance(code, int) else None,
                )
            raise StdioHarnessError(str(error))
        result = message.get("result")
        if not isinstance(result, dict):
            raise StdioHarnessError(f"{method} result must be an object")
        return result

    def _read_stdout(self) -> None:
        proc = self._proc
        if proc is None or proc.stdout is None:
            return
        try:
            for line in proc.stdout:
                raw = line.strip()
                if not raw:
                    continue
                try:
                    message = json.loads(raw)
                except json.JSONDecodeError:
                    continue
                if not isinstance(message, dict):
                    continue
                request_id = message.get("id")
                if isinstance(request_id, int) and (
                    "result" in message or "error" in message
                ):
                    self._results[request_id] = message
                    waiter = self._waiters.get(request_id)
                    if waiter is not None:
                        waiter.set()
                    continue
                if isinstance(message.get("method"), str):
                    self._notes.append(message)
        finally:
            self._fail_waiters("xrkh stdio closed")

    def _read_stderr(self) -> None:
        proc = self._proc
        if proc is None or proc.stderr is None:
            return
        for line in proc.stderr:
            text = line.strip()
            if text:
                self._stderr.append(text)

    def _fail_waiters(self, message: str) -> None:
        for event in list(self._waiters.values()):
            event.set()
        _ = message
