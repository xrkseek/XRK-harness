import { describe, expect, it } from "vitest";
import {
  FaceInboxWireMaps,
  FaceToolArgMaps,
  FaceWireIdMaps,
} from "../src/index.js";
import type { SessionEvent } from "@xrkseek/protocol";

describe("Face session-scoped accumulators clear on eviction", () => {
  it("FaceWireIdMaps.clear drops every per-session bucket", () => {
    const maps = new FaceWireIdMaps();
    // Seed turn/step counters for two sessions.
    expect(maps.turn("s1", "t1")).toBe(1);
    expect(maps.turn("s1", "t2")).toBe(2);
    expect(maps.step("s1", "t1", "st1")).toBe(1);
    expect(maps.step("s1", "t1", "st2")).toBe(2);
    expect(maps.turn("s2", "t9")).toBe(1);

    // Evict s1; its buckets vanish but s2 stays intact.
    maps.clear("s1");

    // A fresh turn id in s1 must restart at 1 (bucket was dropped).
    expect(maps.turn("s1", "t-new")).toBe(1);
    expect(maps.step("s1", "t-new", "st-new")).toBe(1);
    // s2 numbering is untouched.
    expect(maps.turn("s2", "t9")).toBe(1);
    expect(maps.step("s2", "t9", "s9")).toBe(1);

    // Clearing an unknown session is a no-op.
    maps.clear("never-existed");
    expect(maps.turn("s2", "t9")).toBe(1);
  });

  it("FaceToolArgMaps.clear removes the outer session entry", () => {
    const maps = new FaceToolArgMaps();
    const toolCall = (id: string): SessionEvent =>
      ({
        type: "tool/call",
        call: { id, name: "bash", arguments: { command: "echo hi" } },
      }) as unknown as SessionEvent;

    maps.remember("s1", toolCall("c1"));
    maps.remember("s1", toolCall("c2"));
    maps.remember("s2", toolCall("c9"));

    // The per-session map holds entries while live.
    const before = maps.forSession("s1");
    expect(before.size).toBe(2);

    maps.clear("s1");

    // After clear, a fresh session map starts empty (outer entry was dropped,
    // not just the inner contents).
    const after = maps.forSession("s1");
    expect(after.size).toBe(0);
    expect(after).not.toBe(before);
    // Other sessions are untouched.
    expect(maps.forSession("s2").size).toBe(1);

    // Clearing an unknown session is a no-op.
    maps.clear("never-existed");
    expect(maps.forSession("s2").size).toBe(1);
  });

  it("FaceInboxWireMaps.clear drops the per-session projector", () => {
    const maps = new FaceInboxWireMaps(new Map([["a1", "rpc-a"]]));
    const first = maps.forSession("s1");
    expect(maps.forSession("s1")).toBe(first);

    maps.clear("s1");

    // A fresh projector is created for the next lookup.
    expect(maps.forSession("s1")).not.toBe(first);

    // Clearing an unknown session is a no-op.
    maps.clear("never-existed");
    expect(maps.forSession("s2")).toBeDefined();
  });
});