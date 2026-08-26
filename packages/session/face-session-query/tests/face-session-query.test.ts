import { describe, expect, it } from "vitest";
import { createMemorySessionStore } from "@xrkseek/core-session";
import {
  listFaceSessionReferenceCandidates,
  readFaceSessionSurface,
  retainFaceReferencedSession,
} from "../src/index.js";
import { SessionId } from "@xrkseek/xrk-session-reference/types";

describe("face-session-query", () => {
  it("lists session mention candidates from Face store", () => {
    const store = createMemorySessionStore();
    const agent = store.create("agent-1");
    store.append(agent.id, {
      type: "turn/start",
      ts: 1,
      turnId: "t0",
    });
    store.append(agent.id, {
      type: "user/message",
      ts: 2,
      turnId: "t0",
      content: "hello",
      source: { kind: "user" },
    });

    const other = store.create("other-1");
    store.append(other.id, {
      type: "turn/start",
      ts: 1,
      turnId: "t1",
    });
    store.append(other.id, {
      type: "user/message",
      ts: 2,
      turnId: "t1",
      content: "secret beta",
      source: { kind: "user" },
    });

    const candidates = listFaceSessionReferenceCandidates(store, {
      agentId: agent.id,
      query: "other",
      resolveCwd: () => "/ws",
    });
    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.sessionId).toBe(SessionId(other.id));
    expect(candidates[0]?.mention).toContain("@");
  });

  it("reads surface and retains referenced session under byte budget", () => {
    const store = createMemorySessionStore();
    const sid = store.create("ref-1").id;
    store.append(sid, {
      type: "turn/start",
      ts: 1,
      turnId: "t0",
    });
    store.append(sid, {
      type: "user/message",
      ts: 2,
      turnId: "t0",
      content: "keep this line",
      source: { kind: "user" },
    });

    const surface = readFaceSessionSurface(store, sid, "/ws");
    expect(surface.sessionId).toBe(SessionId(sid));
    expect(surface.events.length).toBeGreaterThan(0);

    const retained = retainFaceReferencedSession(store, {
      sessionId: sid,
      label: "Ref",
      cwd: "/ws",
      maxBytes: 4096,
    });
    expect(retained?.data.label).toBe("Ref");
    expect(
      retained?.data.conversation.some((row) =>
        row.text.includes("keep this line"),
      ),
    ).toBe(true);
  });
});
