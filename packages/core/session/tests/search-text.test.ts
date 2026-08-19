import { describe, expect, it } from "vitest";
import type { SessionEvent } from "@xrkseek/protocol";
import { extractEventSearchText, extractSessionSearchTexts } from "../src/search-text.js";

describe("extractEventSearchText", () => {
  it("collects user and command text", () => {
    const events: SessionEvent[] = [
      { type: "user/message", ts: 1, turnId: "t", content: "hello world" },
      { type: "command/run", ts: 2, commandId: "c", name: "plan", args: "", source: { kind: "user" } },
    ];
    expect(extractSessionSearchTexts(events)).toEqual(["hello world", "plan"]);
    expect(extractEventSearchText(events[1]!)).toBe("plan");
  });
});
