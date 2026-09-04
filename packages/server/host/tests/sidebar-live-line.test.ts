import { describe, expect, it } from "vitest";
import type { SessionEvent } from "@xrkseek/protocol";
import { liveLineFromSessionEvents } from "../src/sidebar-live-line.js";

describe("liveLineFromSessionEvents", () => {
  it("emits nested tool shape for tool/call (xrkh LastActivity wire)", () => {
    const events = [
      {
        type: "tool/call",
        call: { name: "bash", arguments: '{"cmd":"ls"}' },
      },
    ] as unknown as SessionEvent[];
    expect(liveLineFromSessionEvents(events)).toEqual({
      tool: { name: "bash", args: '{"cmd":"ls"}' },
    });
  });

  it("emits nested tool for assistant/chunk tool-call without flat args sibling", () => {
    const events = [
      {
        type: "assistant/chunk",
        kind: "tool-call",
        toolName: "read_file",
        argumentsDelta: "path",
      },
    ] as unknown as SessionEvent[];
    expect(liveLineFromSessionEvents(events)).toEqual({
      tool: { name: "read_file", args: "path" },
    });
  });

  it("returns text-only for assistant/message", () => {
    const events = [
      {
        type: "assistant/message",
        content: "  hello world  ",
      },
    ] as unknown as SessionEvent[];
    expect(liveLineFromSessionEvents(events)).toEqual({
      text: "hello world",
    });
  });
});
