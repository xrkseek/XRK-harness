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

  it("invokes onMessage when provided (Face inject hook)", async () => {
    const root = tempRoot();
    const calls: string[] = [];
    const handler = createA2aInboundHandler({
      url: "http://127.0.0.1:9/a2a",
      conversationsRoot: root,
      env: {},
      onMessage: async ({ text, peer }) => {
        calls.push(`${peer}:${text}`);
        return `face-reply:${text}`;
      },
    });
    const sendReq = {
      method: "POST",
      url: "/a2a",
      headers: {},
      socket: { remoteAddress: "127.0.0.1" },
      on(ev: string, cb: (x?: Buffer) => void) {
        if (ev === "data") {
          cb(
            Buffer.from(
              JSON.stringify({
                jsonrpc: "2.0",
                id: 2,
                method: "message/send",
                params: {
                  message: {
                    role: "ROLE_USER",
                    parts: [{ text: "inject me" }],
                    contextId: "ctx_face",
                  },
                },
              }),
            ),
          );
        }
        if (ev === "end") cb();
        return sendReq;
      },
    } as unknown as import("node:http").IncomingMessage;
    let sendBody = "";
    const sendRes = {
      writeHead() {},
      end(raw: string) {
        sendBody = raw;
      },
    } as unknown as import("node:http").ServerResponse;
    expect(await handler(sendReq, sendRes)).toBe(true);
    expect(calls[0]).toMatch(/inject me/);
    const rpc = JSON.parse(sendBody) as {
      result: { task: { status: { message: { parts: { text: string }[] } } } };
    };
    const reply = rpc.result.task.status.message.parts.map((p) => p.text).join("");
    expect(reply).toContain("face-reply:inject me");
  });

  it("accepts SendMessage alias and serves tasks/get|list|cancel", async () => {
    const root = tempRoot();
    const handler = createA2aInboundHandler({
      url: "http://127.0.0.1:9/a2a",
      conversationsRoot: root,
      env: {},
    });

    async function rpc(
      method: string,
      params: Record<string, unknown>,
      id: number,
    ): Promise<Record<string, unknown>> {
      const sendReq = {
        method: "POST",
        url: "/a2a",
        headers: {},
        socket: { remoteAddress: "127.0.0.1" },
        on(ev: string, cb: (x?: Buffer) => void) {
          if (ev === "data") {
            cb(Buffer.from(JSON.stringify({ jsonrpc: "2.0", id, method, params })));
          }
          if (ev === "end") cb();
          return sendReq;
        },
      } as unknown as import("node:http").IncomingMessage;
      let body = "";
      const sendRes = {
        writeHead() {},
        end(raw: string) {
          body = raw;
        },
      } as unknown as import("node:http").ServerResponse;
      expect(await handler(sendReq, sendRes)).toBe(true);
      return JSON.parse(body) as Record<string, unknown>;
    }

    const sent = await rpc(
      "SendMessage",
      {
        message: {
          role: "ROLE_USER",
          parts: [{ text: "via pascal" }],
          contextId: "ctx_tasks",
        },
      },
      10,
    );
    const task = (sent.result as { task: { id: string; status: { state: string } } }).task;
    expect(task.status.state).toBe("TASK_STATE_COMPLETED");
    expect(task.id).toMatch(/^task_/);

    const got = await rpc("GetTask", { taskId: task.id }, 11);
    expect((got.result as { id: string }).id).toBe(task.id);

    const listed = await rpc("tasks/list", { contextId: "ctx_tasks" }, 12);
    const list = listed.result as { tasks: { id: string }[]; totalSize: number };
    expect(list.totalSize).toBeGreaterThanOrEqual(1);
    expect(list.tasks.some((t) => t.id === task.id)).toBe(true);

    // Cancel requires a non-terminal task — create one then cancel mid-flight via store is hard;
    // send a second message and cancel an already-completed task should 32002.
    const cancelDone = await rpc("CancelTask", { taskId: task.id }, 13);
    expect((cancelDone.error as { code: number }).code).toBe(-32002);

    // Working cancel: inject a store with an open task via a custom handler.
    const { TaskStore } = await import("../src/task-store.js");
    const store = new TaskStore();
    store.create("task_open", "ctx_open", "peer");
    const cancelHandler = createA2aInboundHandler({
      url: "http://127.0.0.1:9/a2a",
      conversationsRoot: root,
      env: {},
      taskStore: store,
    });
    const cancelReq = {
      method: "POST",
      url: "/a2a",
      headers: {},
      socket: { remoteAddress: "127.0.0.1" },
      on(ev: string, cb: (x?: Buffer) => void) {
        if (ev === "data") {
          cb(Buffer.from(JSON.stringify({
            jsonrpc: "2.0",
            id: 14,
            method: "tasks/cancel",
            params: { taskId: "task_open" },
          })));
        }
        if (ev === "end") cb();
        return cancelReq;
      },
    } as unknown as import("node:http").IncomingMessage;
    let cancelBody = "";
    const cancelRes = {
      writeHead() {},
      end(raw: string) {
        cancelBody = raw;
      },
    } as unknown as import("node:http").ServerResponse;
    expect(await cancelHandler(cancelReq, cancelRes)).toBe(true);
    const canceled = JSON.parse(cancelBody) as {
      result: { status: { state: string } };
    };
    expect(canceled.result.status.state).toBe("TASK_STATE_CANCELED");
  });
});

describe("a2a outbound SendMessage → message/send fallback", () => {
  it("retries with message/send when peer rejects PascalCase", async () => {
    const root = tempRoot();
    let calls = 0;
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      const url = String(_url);
      if (url.includes("agent-card")) {
        return new Response(JSON.stringify({ name: "peer", url: "http://peer.test/a2a" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      calls += 1;
      const body = JSON.parse(String(init?.body ?? "{}")) as { method?: string };
      if (body.method === "SendMessage") {
        return new Response(
          JSON.stringify({
            jsonrpc: "2.0",
            id: "1",
            error: { code: -32601, message: "method not found: SendMessage" },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      return new Response(
        JSON.stringify({
          jsonrpc: "2.0",
          id: "1",
          result: {
            task: {
              id: "task",
              contextId: "ctx_fb",
              status: {
                state: "TASK_STATE_COMPLETED",
                message: { role: "ROLE_AGENT", parts: [{ text: "slash-ok" }] },
              },
            },
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    });
    const client = createA2aClient({
      conversationsRoot: root,
      peers: { bot: { url: "http://peer.test" } },
      fetch: fetchImpl as unknown as typeof fetch,
    });
    const result = await client.call("bot", "hi", "ctx_fb");
    expect(result.ok).toBe(true);
    expect(result.content).toMatch(/slash-ok/);
    expect(calls).toBe(2);
  });
});

describe("a2a inbound framing", () => {
  it("wraps peer text so slash-looking lines stay data", async () => {
    const { wrapA2aInboundText, filterA2aInboundText } = await import(
      "../src/inbound-frame.js"
    );
    expect(filterA2aInboundText("hello <system>x</system>")).toContain(
      "[filtered]",
    );
    const framed = wrapA2aInboundText("alice", "/status");
    expect(framed).toMatch(/A2A inbound/);
    expect(framed).toMatch(/alice/);
    expect(framed).toContain("/status");
  });
});
