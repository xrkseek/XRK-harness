import { describe, expect, it } from "vitest";
import type { SessionEvent } from "@xrkseek/protocol";
import { collectToolCallArgsForPage } from "../src/adapt/tool-view.js";

describe("collectToolCallArgsForPage", () => {
  it("only backscans calls needed by the page (bounded)", () => {
    const events: SessionEvent[] = [];
    for (let i = 0; i < 50; i++) {
      events.push({
        type: "tool/call",
        ts: i,
        turnId: "t",
        stepId: "s",
        call: {
          id: `c${i}`,
          name: "read_file",
          arguments: { path: `f${i}` },
        },
      });
    }
    events.push({
      type: "tool/result",
      ts: 50,
      turnId: "t",
      stepId: "s",
      result: {
        toolCallId: "c42",
        name: "read_file",
        content: "ok",
        isError: false,
      },
    });
    const page = [events[events.length - 1]!];
    const seqByEvent = new Map<SessionEvent, number>();
    for (let i = 0; i < events.length; i++) seqByEvent.set(events[i]!, i + 1);

    const map = collectToolCallArgsForPage(events, page, seqByEvent);
    expect(map.size).toBe(1);
    expect(map.get("c42")).toEqual({
      name: "read_file",
      args: { path: "f42" },
    });
  });

  it("returns empty map when the page has no tool/result", () => {
    const events: SessionEvent[] = [
      {
        type: "user/message",
        ts: 1,
        turnId: "t",
        content: "hi",
      },
    ];
    const seqByEvent = new Map([[events[0]!, 1]]);
    expect(collectToolCallArgsForPage(events, events, seqByEvent).size).toBe(0);
  });
});
