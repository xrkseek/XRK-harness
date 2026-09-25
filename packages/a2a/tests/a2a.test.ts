import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  TurnTracker,
  createA2aClient,
  createA2aTools,
  createA2aInboundHandler,
  listPersistedContexts,
  loadConversation,
  maxPingpongTurns,
  persistMessage,
} from "../src/index.js";

const temps: string[] = [];

afterEach(() => {
  for (const d of temps.splice(0)) {
    try {
      rmSync(d, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
});

function tempRoot(): string {
  const d = mkdtempSync(path.join(tmpdir(), "xrk-a2a-"));
  temps.push(d);
  return d;
}

describe("a2a protocol persistence + anti-loop", () => {
  it("persists and recalls conversation by context_id", () => {
    const root = tempRoot();
    persistMessage("ctx_demo", "user", "hello", "t1", { root });
    persistMessage("ctx_demo", "agent", "world", "t1", { root });
    const msgs = loadConversation("ctx_demo", 10, { root });
    expect(msgs.map((m) => m.text)).toEqual(["hello", "world"]);
    expect(listPersistedContexts({ root })).toContain("ctx_demo");
  });

  it("caps pingpong turns (default 5, hard max 20)", () => {
    expect(maxPingpongTurns({})).toBe(5);
    expect(maxPingpongTurns({ XRK_A2A_MAX_PINGPONG_TURNS: "3" })).toBe(3);
    expect(maxPingpongTurns({ XRK_A2A_MAX_PINGPONG_TURNS: "99" })).toBe(20);
    const tracker = new TurnTracker();
    expect(tracker.track("c")).toBe(1);
    expect(tracker.track("c")).toBe(2);
    tracker.reset("c");
    expect(tracker.track("c")).toBe(1);
  });

  it("a2a_call rejects after turn cap and still persists prior turns", async () => {
    const root = tempRoot();
    const fetchImpl = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          jsonrpc: "2.0",
          id: "1",
          result: {
            task: {
              id: "task",
              contextId: "ctx_loop",
              status: {
                state: "TASK_STATE_COMPLETED",
                message: {
                  role: "ROLE_AGENT",
                  parts: [{ text: "pong" }],
                },
              },
            },
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    });
    const client = createA2aClient({
      env: { XRK_A2A_MAX_PINGPONG_TURNS: "2" },
      conversationsRoot: root,
      peers: { bot: { url: "http://peer.test" } },
      fetch: fetchImpl as unknown as typeof fetch,
    });

    const first = await client.call("bot", "hi", "ctx_loop");
    expect(first.ok).toBe(true);
    const second = await client.call("bot", "again", "ctx_loop");
    expect(second.ok).toBe(true);
    const third = await client.call("bot", "too-many", "ctx_loop");
    expect(third.ok).toBe(false);
    expect(third.content).toMatch(/anti-loop/);
    expect(third.state).toBe("TASK_STATE_REJECTED");
    expect(loadConversation("ctx_loop", 20, { root }).length).toBe(4);
  });

  it("exposes a2a_history tool over persisted logs", async () => {
    const root = tempRoot();
    persistMessage("ctx_h", "user", "q", "t", { root });
    persistMessage("ctx_h", "agent", "a", "t", { root });
    const tools = createA2aTools({
      conversationsRoot: root,
      peers: {},
    });
    const history = tools.find((t) => t.name === "a2a_history")!;
    const out = await history.execute({ context_id: "ctx_h" });
    expect(out.content).toMatch(/\[user\] q/);
    expect(out.content).toMatch(/\[agent\] a/);
  });
});

describe("a2a inbound Agent Card + message/send", () => {
  it("serves card and completes message/send with persistence", async () => {
    const root = tempRoot();
    const handler = createA2aInboundHandler({
      url: "http://127.0.0.1:9/a2a",
      conversationsRoot: root,
      env: {},
    });
    const cardReq = {
      method: "GET",
      url: "/.well-known/agent-card.json",
      headers: {},
      socket: { remoteAddress: "127.0.0.1" },
    } as unknown as import("node:http").IncomingMessage;
    let cardStatus = 0;
    let cardBody = "";
    const cardRes = {
      writeHead(status: number) {
        cardStatus = status;
      },
      end(raw: string) {
        cardBody = raw;
      },
    } as unknown as import("node:http").ServerResponse;
    expect(await handler(cardReq, cardRes)).toBe(true);
    expect(cardStatus).toBe(200);
    const card = JSON.parse(cardBody) as { name: string; supportedInterfaces: unknown[] };
    expect(card.name).toContain("XRK");
    expect(card.supportedInterfaces.length).toBe(1);

    const sendReq = {
      method: "POST",
      url: "/a2a",
      headers: {},
      socket: { remoteAddress: "127.0.0.1" },
      on(ev: string, cb: (x?: Buffer) => void) {
        if (ev === "data") {
          cb(Buffer.from(JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            method: "message/send",
            params: {
              message: {
                role: "ROLE_USER",
                parts: [{ text: "ping inbound" }],
                contextId: "ctx_in",
              },
            },
          })));
        }
        if (ev === "end") cb();
        return sendReq;
      },
    } as unknown as import("node:http").IncomingMessage;
    let sendStatus = 0;
    let sendBody = "";
    const sendRes = {
      writeHead(status: number) {
        sendStatus = status;
      },
      end(raw: string) {
        sendBody = raw;
      },
    } as unknown as import("node:http").ServerResponse;
    expect(await handler(sendReq, sendRes)).toBe(true);
    expect(sendStatus).toBe(200);
    const rpc = JSON.parse(sendBody) as {
      result: { task: { contextId: string; status: { state: string } } };
    };
    expect(rpc.result.task.contextId).toBe("ctx_in");
    expect(rpc.result.task.status.state).toBe("TASK_STATE_COMPLETED");
    const msgs = loadConversation("ctx_in", 10, { root });
    expect(msgs.some((m) => m.text.includes("ping inbound"))).toBe(true);
  });
});
