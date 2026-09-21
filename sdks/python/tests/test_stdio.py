import sys
import textwrap
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from xrk_harness import HarnessClient, StdioHarnessClient, StdioHarnessError


FAKE = textwrap.dedent(
    """\
    import json, sys
    for line in sys.stdin:
        raw = line.strip()
        if not raw:
            continue
        msg = json.loads(raw)
        method = msg.get("method")
        mid = msg.get("id")
        params = msg.get("params") or {}
        def respond(result):
            sys.stdout.write(json.dumps({"jsonrpc": "2.0", "id": mid, "result": result}) + "\\n")
            sys.stdout.flush()
        if method == "initialize":
            respond({"protocolVersion": 1, "agentInfo": {"name": "xrk-harness", "version": "test"}})
        elif method == "session/new":
            respond({"sessionId": "acp_test"})
        elif method == "session/prompt":
            prompt = params.get("prompt") or []
            text = ""
            if isinstance(prompt, list):
                text = "".join(
                    block.get("text", "") for block in prompt if isinstance(block, dict)
                )
            note = {
                "jsonrpc": "2.0",
                "method": "session/update",
                "params": {
                    "sessionId": params.get("sessionId"),
                    "update": {
                        "sessionUpdate": "agent_message_chunk",
                        "content": {"type": "text", "text": "pong:" + text},
                    },
                },
            }
            sys.stdout.write(json.dumps(note) + "\\n")
            sys.stdout.flush()
            respond({"stopReason": "end_turn"})
        else:
            sys.stdout.write(
                json.dumps(
                    {
                        "jsonrpc": "2.0",
                        "id": mid,
                        "error": {"code": -32601, "message": "method not found: " + str(method)},
                    }
                )
                + "\\n"
            )
            sys.stdout.flush()
    """
)


class StdioClientTest(unittest.TestCase):
    def test_run_speaks_acp_and_keeps_http_client(self) -> None:
        self.assertTrue(hasattr(HarnessClient, "chat"))
        fake = Path(__file__).resolve().parent / "_fake_xrkh_acp.py"
        fake.write_text(FAKE, encoding="utf-8")
        try:
            with StdioHarnessClient([sys.executable, str(fake)], timeout=5) as client:
                first = client.run("ping", cwd=".")
                self.assertEqual(first["sessionId"], "acp_test")
                self.assertEqual(first["stopReason"], "end_turn")
                self.assertEqual(first["text"], "pong:ping")
                second = client.run("again")
                self.assertEqual(second["sessionId"], "acp_test")
                self.assertEqual(second["text"], "pong:again")
        finally:
            fake.unlink(missing_ok=True)

    def test_unknown_method_is_an_error(self) -> None:
        fake = Path(__file__).resolve().parent / "_fake_xrkh_acp.py"
        fake.write_text(FAKE, encoding="utf-8")
        try:
            client = StdioHarnessClient([sys.executable, str(fake)], timeout=5)
            client.start()
            try:
                with self.assertRaises(StdioHarnessError) as caught:
                    client._request("session/load", {})
                self.assertEqual(caught.exception.code, -32601)
            finally:
                client.close()
        finally:
            fake.unlink(missing_ok=True)


if __name__ == "__main__":
    unittest.main()
