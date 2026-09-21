import { describe, expect, it } from "vitest";
import {
  createMemorySessionStore,
  deriveMessages,
  ensureDurableImageOffloads,
  foldImageOffloadMarks,
  forkSession,
  planImageOffloadTargets,
  projectOffloadedImages,
} from "../src/index.js";

const big = {
  attachmentId: "big",
  mediaType: "image/png" as const,
  bytes: 16 * 1024 * 1024,
  width: 100,
  height: 100,
};

describe("image/offload", () => {
  it("projects marks onto derived messages without rewriting source events", () => {
    const store = createMemorySessionStore();
    const s = store.create("src");
    store.append(s.id, {
      type: "user/message",
      ts: 1,
      turnId: "t1",
      content: [
        { type: "image", attachment: big },
        { type: "text", text: "caption" },
      ],
    });
    store.append(s.id, {
      type: "image/offload",
      ts: 2,
      targets: [{ seq: 0, imageIndexes: [0] }],
    });

    const raw = store.get(s.id).events[0]!;
    expect(raw.type).toBe("user/message");
    if (raw.type === "user/message" && typeof raw.content !== "string") {
      expect(raw.content[0]).toEqual({ type: "image", attachment: big });
    }

    const derived = deriveMessages(store.get(s.id).events);
    expect(derived).toHaveLength(1);
    const content = derived[0]!.content;
    expect(typeof content).not.toBe("string");
    if (typeof content === "string") throw new Error("expected blocks");
    expect(content[0]).toEqual({
      type: "image",
      attachment: big,
      offloaded: true,
    });
    expect(content[1]).toEqual({ type: "text", text: "caption" });
  });

  it("keeps offload marks across fork of the seed prefix", () => {
    const store = createMemorySessionStore();
    const s = store.create("parent");
    store.append(s.id, {
      type: "user/message",
      ts: 1,
      turnId: "t1",
      content: [{ type: "image", attachment: big }],
    });
    store.append(s.id, {
      type: "image/offload",
      ts: 2,
      targets: [{ seq: 0, imageIndexes: [0] }],
    });
    store.append(s.id, {
      type: "user/message",
      ts: 3,
      turnId: "t2",
      content: "later",
    });

    const child = forkSession(store, s.id, 2, "child");
    expect(store.get(child.id).events.map((e) => e.type)).toEqual([
      "user/message",
      "image/offload",
    ]);
    const derived = deriveMessages(store.get(child.id).events);
    const content = derived[0]!.content;
    if (typeof content === "string") throw new Error("expected blocks");
    expect(content[0]).toMatchObject({ type: "image", offloaded: true });
  });

  it("plans oldest retained occurrences under a byte budget", () => {
    const store = createMemorySessionStore();
    const s = store.create("budget");
    const mid = {
      attachmentId: "mid",
      mediaType: "image/png" as const,
      bytes: 12 * 1024 * 1024,
      width: 100,
      height: 100,
    };
    store.append(s.id, {
      type: "user/message",
      ts: 1,
      turnId: "t1",
      content: [
        { type: "image", attachment: mid },
        { type: "image", attachment: { ...mid, attachmentId: "mid2" } },
      ],
    });
    // Two ~16MiB base64 payloads exceed 20MiB; offloading the oldest leaves one.
    const targets = planImageOffloadTargets(store.get(s.id).events, 20 * 1024 * 1024);
    expect(targets).toEqual([{ seq: 0, imageIndexes: [0] }]);

    expect(
      ensureDurableImageOffloads(store, s.id, 20 * 1024 * 1024, () => 99),
    ).toBe(true);
    expect(foldImageOffloadMarks(store.get(s.id).events).get(0)).toEqual(
      new Set([0]),
    );
    // Second pass is a no-op once under budget.
    expect(ensureDurableImageOffloads(store, s.id, 20 * 1024 * 1024)).toBe(
      false,
    );
  });

  it("projectOffloadedImages is idempotent on already marked blocks", () => {
    const content = [
      { type: "image" as const, attachment: big, offloaded: true as const },
    ];
    expect(projectOffloadedImages(content, [0])).toBe(content);
  });

  it("projects tool/result images via deriveMessages", () => {
    const store = createMemorySessionStore();
    const s = store.create("tool-img");
    store.append(s.id, {
      type: "assistant/message",
      ts: 1,
      turnId: "t1",
      stepId: "s1",
      content: "",
      toolCalls: [{ id: "c1", name: "read_image", arguments: {} }],
    });
    store.append(s.id, {
      type: "tool/result",
      ts: 2,
      turnId: "t1",
      stepId: "s1",
      result: {
        toolCallId: "c1",
        name: "read_image",
        content: [
          { type: "text", text: "shot" },
          { type: "image", attachment: big },
        ],
      },
    });
    store.append(s.id, {
      type: "image/offload",
      ts: 3,
      targets: [{ seq: 1, imageIndexes: [0] }],
    });
    const derived = deriveMessages(store.get(s.id).events);
    const tool = derived.find((m) => m.role === "tool");
    expect(tool).toBeDefined();
    if (!tool || typeof tool.content === "string") {
      throw new Error("expected tool blocks");
    }
    expect(tool.content[1]).toMatchObject({
      type: "image",
      offloaded: true,
    });
  });

  it("keeps absolute offload seq across compaction window", () => {
    const store = createMemorySessionStore();
    const s = store.create("compact-offload");
    store.append(s.id, {
      type: "user/message",
      ts: 1,
      turnId: "t0",
      content: "old",
    });
    store.append(s.id, {
      type: "context/compaction",
      ts: 2,
      reason: "auto",
      summary: "## Objective\n- prior",
      recent: "[User]: old",
    });
    // Absolute seq 2 after compact event at index 1.
    store.append(s.id, {
      type: "user/message",
      ts: 3,
      turnId: "t1",
      content: [
        { type: "image", attachment: big },
        { type: "text", text: "after-compact" },
      ],
    });
    store.append(s.id, {
      type: "image/offload",
      ts: 4,
      targets: [{ seq: 2, imageIndexes: [0] }],
    });

    const derived = deriveMessages(store.get(s.id).events);
    expect(derived[0]?.content).toContain("context compacted");
    const user = derived[1];
    expect(user?.role).toBe("user");
    if (!user || typeof user.content === "string") {
      throw new Error("expected image blocks after compact");
    }
    expect(user.content[0]).toMatchObject({
      type: "image",
      offloaded: true,
    });
    expect(user.content[1]).toEqual({
      type: "text",
      text: "after-compact",
    });
  });
});
