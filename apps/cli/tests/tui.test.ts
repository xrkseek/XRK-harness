import { describe, expect, it, vi } from "vitest";
import {
  faceCall,
  resolveFaceApiKey,
  resolveFaceBaseUrl,
} from "../src/face-client.js";
import {
  createTuiRenderState,
  formatToolRailSummary,
  handleMuxPayload,
} from "../src/tui-render.js";
import { parseArgs, helpText } from "../src/parse-args.js";

describe("face-client", () => {
  it("resolveFaceBaseUrl defaults and trims", () => {
    expect(resolveFaceBaseUrl()).toBe("http://127.0.0.1:8787");
    expect(resolveFaceBaseUrl("localhost", 9000)).toBe("http://localhost:9000");
  });

  it("resolveFaceApiKey reads XRK_API_KEY", () => {
    expect(resolveFaceApiKey({})).toBeUndefined();
    expect(resolveFaceApiKey({ XRK_API_KEY: "  secret  " })).toBe("secret");
  });

  it("faceCall posts client-request and unwraps ok value", async () => {
    const fetchImpl = vi.fn(async () =>
      Response.json({
        type: "server-response",
        rpcId: "r1",
        result: { ok: true, value: { sessionId: "s1" } },
      }),
    );
    const res = await faceCall(
      { baseUrl: "http://127.0.0.1:8787", fetchImpl: fetchImpl as typeof fetch },
      "session.create",
      { cwd: "/tmp" },
    );
    expect(res).toEqual({ ok: true, value: { sessionId: "s1" } });
    expect(fetchImpl).toHaveBeenCalledOnce();
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe("http://127.0.0.1:8787/api/session.create");
    const body = JSON.parse(String((init as RequestInit).body));
    expect(body.type).toBe("client-request");
    expect(body.payload).toEqual({ cwd: "/tmp" });
  });

  it("faceCall maps host unreachable", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("ECONNREFUSED");
    });
    const res = await faceCall(
      { baseUrl: "http://127.0.0.1:1", fetchImpl: fetchImpl as typeof fetch },
      "host.describe",
      {},
    );
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.code).toBe("host-unreachable");
      expect(res.message).toMatch(/ECONNREFUSED/);
    }
  });
});

describe("tui-render", () => {
  it("streams assistant/chunk text and closes on turn/end", () => {
    const chunks: string[] = [];
    const state = createTuiRenderState();
    const out = { write: (s: string) => chunks.push(s) };

    handleMuxPayload(
      "s1",
      {
        type: "session/event",
        sessionId: "s1",
        seq: 1,
        event: { type: "assistant/chunk", text: "Hel" },
      },
      out,
      state,
    );
    handleMuxPayload(
      "s1",
      {
        type: "session/event",
        sessionId: "s1",
        seq: 2,
        event: { type: "assistant/chunk", text: "lo" },
      },
      out,
      state,
    );
    const end = handleMuxPayload(
      "s1",
      {
        type: "session/event",
        sessionId: "s1",
        seq: 3,
        event: { type: "turn/end", reason: "completed" },
      },
      out,
      state,
    );

    expect(chunks.join("")).toBe("Hello\n");
    expect(end.turnIdle).toBe(true);
  });

  it("prints tool rail for call and result", () => {
    const chunks: string[] = [];
    const state = createTuiRenderState();
    const out = { write: (s: string) => chunks.push(s) };

    handleMuxPayload(
      "s1",
      {
        type: "session/event",
        sessionId: "s1",
        seq: 1,
        event: {
          type: "tool/call",
          call: { id: "c1", name: "bash" },
        },
      },
      out,
      state,
    );
    expect(formatToolRailSummary(state)).toBe("bash");
    handleMuxPayload(
      "s1",
      {
        type: "session/event",
        sessionId: "s1",
        seq: 2,
        event: {
          type: "tool/result",
          callId: "c1",
          content: "ok output",
        },
      },
      out,
      state,
    );

    const text = chunks.join("");
    expect(text).toMatch(/\[tool\] bash\s+…/);
    expect(text).toMatch(/\[tool\] bash\s+ok/);
    expect(formatToolRailSummary(state)).toBe("");
  });

  it("ignores other sessions", () => {
    const chunks: string[] = [];
    const state = createTuiRenderState();
    handleMuxPayload(
      "s1",
      {
        type: "session/event",
        sessionId: "other",
        seq: 1,
        event: { type: "assistant/chunk", text: "nope" },
      },
      { write: (s: string) => chunks.push(s) },
      state,
    );
    expect(chunks).toEqual([]);
  });
});

describe("parseArgs tui", () => {
  it("parses tui with host/port and harness default preset", () => {
    const a = parseArgs(["tui", "--port", "8799", "--host", "127.0.0.1"]);
    expect(a.command).toBe("tui");
    expect(a.port).toBe(8799);
    expect(a.host).toBe("127.0.0.1");
    expect(a.preset).toBe("harness");
  });

  it("lists tui in help", () => {
    expect(helpText()).toMatch(/tui/);
  });
});
