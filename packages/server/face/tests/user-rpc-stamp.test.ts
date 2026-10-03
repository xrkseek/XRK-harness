import { describe, expect, it } from "vitest";
import { createMemorySessionStore, newSession } from "@xrkseek/core-session";
import { createBareFaceRuntime } from "./helpers/bare-runtime.js";

describe("Face pendingUserRpc stamp", () => {
  it("stamps rpcId on the human prompt, not on preceding durable injects", () => {
    const store = createMemorySessionStore();
    const session = newSession(store);
    const runtime = createBareFaceRuntime({ store });
    const echoRpc = "rpc_echo_1";
    runtime.pendingUserRpc.set(session.id, [{ rpc: echoRpc, steer: false }]);

    store.append(session.id, {
      type: "user/message",
      ts: 1,
      turnId: "t1",
      messageId: "umsg_inject",
      content: "standing instructions",
      source: {
        kind: "agent-instructions",
        form: "instructions",
        changes: [{ action: "set", path: "AGENTS.md" }],
      },
    });
    store.append(session.id, {
      type: "user/message",
      ts: 2,
      turnId: "t1",
      messageId: "umsg_human",
      content: "hello",
      source: { kind: "user" },
    });

    const events = store.get(session.id).events;
    const inject = events.find(
      (e) => e.type === "user/message" && e.messageId === "umsg_inject",
    );
    const human = events.find(
      (e) => e.type === "user/message" && e.messageId === "umsg_human",
    );
    expect(inject?.type).toBe("user/message");
    if (inject?.type === "user/message") {
      expect(inject.rpcId).toBeUndefined();
    }
    expect(human?.type).toBe("user/message");
    if (human?.type === "user/message") {
      expect(human.rpcId).toBe(echoRpc);
    }
    expect(runtime.pendingUserRpc.has(session.id)).toBe(false);
  });

  it("FIFO stamps keep concurrent promotes matched to their human rows", () => {
    const store = createMemorySessionStore();
    const session = newSession(store);
    const runtime = createBareFaceRuntime({ store });
    runtime.admitRpcMap.set("admit_a", "rpc_a");
    runtime.admitRpcMap.set("admit_b", "rpc_b");

    store.append(session.id, {
      type: "prompt/promoted",
      ts: 1,
      admitId: "admit_a",
    });
    // Second promote before the first human row (async inject gap).
    store.append(session.id, {
      type: "prompt/promoted",
      ts: 2,
      admitId: "admit_b",
    });
    store.append(session.id, {
      type: "user/message",
      ts: 3,
      turnId: "t1",
      messageId: "umsg_a",
      content: "first",
      source: { kind: "user" },
    });
    store.append(session.id, {
      type: "user/message",
      ts: 4,
      turnId: "t2",
      messageId: "umsg_b",
      content: "second",
      source: { kind: "user" },
    });

    const events = store.get(session.id).events;
    const a = events.find((e) => e.type === "user/message" && e.messageId === "umsg_a");
    const b = events.find((e) => e.type === "user/message" && e.messageId === "umsg_b");
    expect(a?.type).toBe("user/message");
    expect(b?.type).toBe("user/message");
    if (a?.type === "user/message") expect(a.rpcId).toBe("rpc_a");
    if (b?.type === "user/message") expect(b.rpcId).toBe("rpc_b");
    expect(runtime.pendingUserRpc.has(session.id)).toBe(false);
  });

  it("coalesced steers stamp every echo id on the single user/message", () => {
    const store = createMemorySessionStore();
    const session = newSession(store);
    const runtime = createBareFaceRuntime({ store });
    runtime.admitRpcMap.set("admit_a", "rpc_a");
    runtime.admitRpcMap.set("admit_b", "rpc_b");

    store.append(session.id, {
      type: "prompt/admitted",
      ts: 1,
      admitId: "admit_a",
      content: "fix A",
      delivery: "steer",
    });
    store.append(session.id, {
      type: "prompt/admitted",
      ts: 2,
      admitId: "admit_b",
      content: "fix B",
      delivery: "steer",
    });
    store.append(session.id, {
      type: "prompt/promoted",
      ts: 3,
      admitId: "admit_a",
    });
    store.append(session.id, {
      type: "prompt/promoted",
      ts: 4,
      admitId: "admit_b",
    });
    store.append(session.id, {
      type: "user/message",
      ts: 5,
      turnId: "t1",
      messageId: "umsg_merged",
      content: "fix A\n\nfix B",
      source: { kind: "user" },
    });

    const human = store.get(session.id).events.find(
      (e) => e.type === "user/message" && e.messageId === "umsg_merged",
    );
    expect(human?.type).toBe("user/message");
    if (human?.type === "user/message") {
      expect(human.rpcId).toBe("rpc_a");
      expect(human.rpcIds).toEqual(["rpc_b"]);
    }
    expect(runtime.pendingUserRpc.has(session.id)).toBe(false);
  });
});
