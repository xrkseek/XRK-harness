import { describe, expect, it } from "vitest";
import {
  boundJsonLine,
  createJsonRunProjection,
  jsonFlagRequested,
  projectSessionEvent,
  writeJsonError,
} from "../src/json-stream.js";
import type { SessionEvent } from "@xrkseek/protocol";

describe("cli json-stream", () => {
  it("bounds over-long strings and marks truncated", () => {
    const line = boundJsonLine(
      { type: "text", text: "x".repeat(20_000) },
      64,
      8_192,
    );
    const parsed = JSON.parse(line) as { truncated?: boolean; text: string };
    expect(parsed.truncated).toBe(true);
    expect(Buffer.byteLength(parsed.text, "utf8")).toBeLessThanOrEqual(64);
  });

  it("writeJsonError emits one bounded error line", () => {
    const chunks: string[] = [];
    writeJsonError({ write: (c) => chunks.push(String(c)) }, "boom");
    expect(chunks).toHaveLength(1);
    expect(JSON.parse(chunks[0]!.trimEnd())).toEqual({
      type: "error",
      message: "boom",
    });
  });

  it("detects --json as a real flag", () => {
    expect(jsonFlagRequested(["run", "--json", "hi"])).toBe(true);
    expect(jsonFlagRequested(["run", "--session-id", "--json", "hi"])).toBe(
      false,
    );
    expect(jsonFlagRequested(["run", "--", "--json"])).toBe(false);
  });

  it("projects assistant and tool events", () => {
    const events: SessionEvent[] = [
      { type: "turn/start", ts: 1, turnId: "t1" },
      {
        type: "assistant/message",
        ts: 2,
        turnId: "t1",
        stepId: "s1",
        content: "hello",
        reasoning: "think",
      },
      {
        type: "tool/call",
        ts: 3,
        turnId: "t1",
        stepId: "s1",
        call: { id: "c1", name: "bash", arguments: { command: "pwd" } },
      },
      {
        type: "tool/result",
        ts: 4,
        turnId: "t1",
        stepId: "s1",
        result: {
          toolCallId: "c1",
          name: "bash",
          content: "/tmp",
        },
      },
      {
        type: "turn/end",
        ts: 5,
        turnId: "t1",
        reason: { kind: "completed" },
      },
    ];
    const lines: string[] = [];
    const proj = createJsonRunProjection({
      write: (chunk) => {
        lines.push(String(chunk).trimEnd());
      },
    });
    proj.poll(events, 0);
    proj.finish("hello");
    proj.error("late");
    const types = lines.map((l) => (JSON.parse(l) as { type: string }).type);
    expect(types).toEqual([
      "status",
      "thinking",
      "text",
      "tool_call",
      "tool_result",
      "status",
      "final",
      "error",
    ]);
    expect(projectSessionEvent(events[0]!).length).toBe(1);
  });
});
