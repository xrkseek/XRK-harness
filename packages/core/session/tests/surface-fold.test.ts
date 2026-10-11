import { describe, expect, it } from "vitest";
import {
  foldSurfaceTokens,
  formatCompactionForModel,
  priceCurrentSurfaceWindow,
  projectedInputPressureTokens,
  estimateMessageContent,
} from "../src/index.js";
import type { SessionEvent } from "@xrkseek/protocol";

describe("surface-fold / shadow-price", () => {
  it("prices the current window and shrinks on shadowed compaction", () => {
    const events: SessionEvent[] = [
      {
        type: "user/message",
        ts: 1,
        turnId: "t1",
        content: "hello world hello",
      },
      {
        type: "assistant/message",
        ts: 2,
        turnId: "t1",
        stepId: "s1",
        content: "ok",
      },
    ];
    const shadowed = priceCurrentSurfaceWindow(events);
    expect(shadowed).toBeGreaterThan(0);

    let surface = 0;
    for (const ev of events) surface = foldSurfaceTokens(surface, ev);
    expect(surface).toBe(shadowed);

    const compact = {
      type: "context/compaction" as const,
      ts: 3,
      reason: "manual" as const,
      summary: "s",
      recent: "",
      shadowedTokenCount: shadowed,
    };
    surface = foldSurfaceTokens(surface, compact);
    expect(surface).toBe(
      estimateMessageContent(formatCompactionForModel(compact)),
    );
  });

  it("leaves surface unchanged when shadowedTokenCount is omitted", () => {
    let surface = foldSurfaceTokens(0, {
      type: "user/message",
      ts: 1,
      turnId: "t1",
      content: "keep",
    });
    const before = surface;
    surface = foldSurfaceTokens(surface, {
      type: "context/compaction",
      ts: 2,
      reason: "auto",
      summary: "long summary that would have reset if immature",
      recent: "r",
    });
    expect(surface).toBe(before);
  });

  it("projects provider pressure forward after the usage stamp", () => {
    const events: SessionEvent[] = [
      {
        type: "user/message",
        ts: 1,
        turnId: "t1",
        content: "hello world hello",
      },
      {
        type: "assistant/message",
        ts: 2,
        turnId: "t1",
        stepId: "s1",
        content: "ok",
        usage: { inputTokens: 1_000, outputTokens: 10, cacheReadTokens: 200 },
      },
      {
        type: "user/message",
        ts: 3,
        turnId: "t2",
        content: "more " + "x".repeat(40),
      },
    ];
    expect(projectedInputPressureTokens(events.slice(0, 1))).toBeUndefined();
    // Stamp before assistant joins the fold → pressure + later user growth.
    const afterAssistant = projectedInputPressureTokens(events.slice(0, 2));
    expect(afterAssistant).toBeGreaterThanOrEqual(1_200);
    const afterUser = projectedInputPressureTokens(events);
    expect(afterUser).toBeGreaterThan(afterAssistant!);

    const shadowed = priceCurrentSurfaceWindow(events);
    const afterCompact = projectedInputPressureTokens([
      ...events,
      {
        type: "context/compaction",
        ts: 4,
        reason: "auto",
        summary: "s",
        recent: "",
        shadowedTokenCount: shadowed,
      },
    ]);
    // Provider sample is dropped on a shadowed window swap.
    expect(afterCompact).toBeUndefined();
  });
});
