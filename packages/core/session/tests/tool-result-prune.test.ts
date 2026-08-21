import { describe, expect, it } from "vitest";
import type { SessionEvent } from "@xrkseek/protocol";
import {
  createMemorySessionStore,
  deriveMessages,
  foldSurfaceTokens,
  priceCurrentSurfaceWindow,
  pruneOversizedToolResults,
  pruneToolResultText,
  TOOL_RESULT_PRUNE_HEAD_CHARS,
  TOOL_RESULT_PRUNE_THRESHOLD_CHARS,
} from "../src/index.js";

describe("tool-result prune", () => {
  it("truncates oversized text with head/tail", () => {
    const raw = "A".repeat(TOOL_RESULT_PRUNE_THRESHOLD_CHARS + 100);
    const out = pruneToolResultText(raw);
    expect(out).toBeDefined();
    expect(out!.startsWith("A".repeat(TOOL_RESULT_PRUNE_HEAD_CHARS))).toBe(
      true,
    );
    expect(out!).toContain("chars omitted");
    expect(out!.length).toBeLessThan(raw.length);
  });

  it("leaves short results alone", () => {
    expect(pruneToolResultText("short")).toBeUndefined();
  });

  it("counts Unicode code points (not UTF-16 units)", () => {
    // Each emoji is one code point but two UTF-16 units.
    const emoji = "😀";
    const raw = emoji.repeat(TOOL_RESULT_PRUNE_THRESHOLD_CHARS + 10);
    expect(raw.length).toBeGreaterThan(TOOL_RESULT_PRUNE_THRESHOLD_CHARS);
    const out = pruneToolResultText(raw);
    expect(out).toBeDefined();
    const units = Array.from(out!);
    expect(units.length).toBeLessThan(Array.from(raw).length);
  });

  it("appends replacement; deriveMessages keeps latest surface", () => {
    const store = createMemorySessionStore();
    const session = store.create();
    const big = "B".repeat(TOOL_RESULT_PRUNE_THRESHOLD_CHARS + 50);
    store.append(session.id, {
      type: "user/message",
      ts: 1,
      turnId: "t",
      content: "go",
    });
    store.append(session.id, {
      type: "assistant/message",
      ts: 2,
      turnId: "t",
      stepId: "s",
      content: "",
      toolCalls: [{ id: "c1", name: "read", arguments: {} }],
    });
    store.append(session.id, {
      type: "tool/result",
      ts: 3,
      turnId: "t",
      stepId: "s",
      result: { toolCallId: "c1", name: "read", content: big },
    });

    const { pruned } = pruneOversizedToolResults(store, session.id);
    expect(pruned).toBe(1);

    const results = store
      .get(session.id)
      .events.filter((e) => e.type === "tool/result");
    expect(results).toHaveLength(2);

    const msgs = deriveMessages(store.get(session.id).events);
    const tool = msgs.find((m) => m.role === "tool");
    expect(typeof tool?.content).toBe("string");
    expect(String(tool?.content).length).toBeLessThan(big.length);
    expect(String(tool?.content)).toContain("chars omitted");
  });

  it("surface fold applies net delta for prune replacement", () => {
    const big = "C".repeat(TOOL_RESULT_PRUNE_THRESHOLD_CHARS + 200);
    const store = createMemorySessionStore();
    const session = store.create();
    const events: SessionEvent[] = [
      {
        type: "tool/result",
        ts: 1,
        turnId: "t",
        stepId: "s",
        result: { toolCallId: "c1", name: "read", content: big },
      },
    ];
    for (const ev of events) store.append(session.id, ev);

    let surface = 0;
    for (const ev of store.get(session.id).events) {
      surface = foldSurfaceTokens(surface, ev);
    }
    const before = surface;

    pruneOversizedToolResults(store, session.id);
    const all = store.get(session.id).events;
    const replacement = all[all.length - 1]!;
    surface = foldSurfaceTokens(surface, replacement);
    expect(surface).toBeLessThan(before);
    expect(priceCurrentSurfaceWindow(all)).toBe(surface);
  });
});
