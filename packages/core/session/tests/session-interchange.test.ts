import { describe, expect, it } from "vitest";
import { fromJSONL } from "../src/jsonl.js";
import {
  exportSessionInterchange,
  importSessionInterchange,
} from "../src/session-interchange.js";

describe("session interchange", () => {
  it("round-trips role JSONL into XRK events without schema v3", () => {
    const foreign = [
      JSON.stringify({ role: "user", content: "hello" }),
      JSON.stringify({ role: "assistant", text: "hi" }),
      "",
    ].join("\n");
    const events = importSessionInterchange(foreign, 1);
    expect(events.map((event) => event.type)).toEqual([
      "turn/start",
      "step/start",
      "user/message",
      "assistant/message",
      "step/end",
      "turn/end",
    ]);
    const exported = exportSessionInterchange(events);
    expect(exported.startsWith("{\"xrkInterchange\":1")).toBe(true);
    const again = importSessionInterchange(exported, 2);
    const user = again.find((event) => event.type === "user/message");
    expect(user && user.type === "user/message" ? user.content : "").toBe("hello");
    expect(fromJSONL(events.map((event) => JSON.stringify(event)).join("\n")).length).toBe(
      events.length,
    );
  });

  it("keeps a later user prompt as its own turn and round-trips tool lines", () => {
    const foreign = [
      JSON.stringify({ role: "user", content: "run", ts: 10 }),
      JSON.stringify({
        role: "assistant",
        content: "ok",
        ts: 11,
        tool_calls: [
          { id: "c1", function: { name: "bash", arguments: "{\"cmd\":\"ls\"}" } },
        ],
      }),
      JSON.stringify({ role: "tool", tool_call_id: "c1", name: "bash", content: "file" }),
      JSON.stringify({ role: "user", content: "thanks", ts: 20 }),
      JSON.stringify({ role: "assistant", text: "done", ts: 21 }),
    ].join("\n");
    const events = importSessionInterchange(foreign, 1);
    const turns = events.filter((event) => event.type === "turn/start");
    expect(turns).toHaveLength(2);
    const call = events.find((event) => event.type === "tool/call");
    expect(call && call.type === "tool/call" ? call.call.name : "").toBe("bash");
    const result = events.find((event) => event.type === "tool/result");
    expect(result && result.type === "tool/result" ? result.result.content : "").toBe("file");
    const again = importSessionInterchange(exportSessionInterchange(events), 2);
    expect(again.filter((event) => event.type === "tool/call")).toHaveLength(1);
    expect(again.filter((event) => event.type === "turn/start")).toHaveLength(2);
  });
});
