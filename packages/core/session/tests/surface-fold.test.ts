import { describe, expect, it } from "vitest";
import {
  foldSurfaceTokens,
  formatCompactionForModel,
  priceCurrentSurfaceWindow,
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
});
