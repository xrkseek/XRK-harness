import { describe, expect, it } from "vitest";
import { createDeltaCoalescer } from "../src/delta-coalesce.js";
import type { ChunkSink } from "../src/llm-retry.js";

describe("createDeltaCoalescer", () => {
  it("emits the first fragment of a run immediately and holds the rest until flush", () => {
    const got: Parameters<ChunkSink>[0][] = [];
    const c = createDeltaCoalescer((chunk) => {
      got.push(chunk);
    });
    c.push({ kind: "reasoning", index: 0, text: "ab" });
    c.push({ kind: "reasoning", index: 0, text: "cd" });
    expect(got).toEqual([{ kind: "reasoning", index: 0, text: "ab" }]);
    c.flush();
    expect(got).toEqual([
      { kind: "reasoning", index: 0, text: "ab" },
      { kind: "reasoning", index: 0, text: "cd" },
    ]);
  });

  it("merges several held fragments of the same run", () => {
    const got: Parameters<ChunkSink>[0][] = [];
    const c = createDeltaCoalescer((chunk) => {
      got.push(chunk);
    });
    c.push({ kind: "text", index: 1, text: "a" });
    c.push({ kind: "text", index: 1, text: "b" });
    c.push({ kind: "text", index: 1, text: "c" });
    c.flush();
    expect(got).toEqual([
      { kind: "text", index: 1, text: "a" },
      { kind: "text", index: 1, text: "bc" },
    ]);
  });

  it("flushes the held tail before a kind change or usage sample", () => {
    const got: Parameters<ChunkSink>[0][] = [];
    const c = createDeltaCoalescer((chunk) => {
      got.push(chunk);
    });
    c.push({ kind: "reasoning", index: 0, text: "th" });
    c.push({ kind: "reasoning", index: 0, text: "ink" });
    c.push({ kind: "text", index: 1, text: "hi" });
    c.push({
      kind: "usage",
      index: 0,
      text: "",
      usage: { inputTokens: 1, outputTokens: 1 },
    });
    expect(got.map((chunk) => chunk.kind)).toEqual([
      "reasoning",
      "reasoning",
      "text",
      "usage",
    ]);
    expect(got[1]).toMatchObject({ kind: "reasoning", text: "ink" });
  });

  it("concatenates tool-call argument tails without mixing call ids", () => {
    const got: Parameters<ChunkSink>[0][] = [];
    const c = createDeltaCoalescer((chunk) => {
      got.push(chunk);
    });
    c.push({
      kind: "tool-call",
      index: 0,
      text: "{",
      toolCallId: "a",
      toolName: "bash",
      argumentsDelta: "{",
    });
    c.push({
      kind: "tool-call",
      index: 0,
      text: "}",
      toolCallId: "a",
      toolName: "bash",
      argumentsDelta: "}",
    });
    c.push({
      kind: "tool-call",
      index: 1,
      text: "x",
      toolCallId: "b",
      toolName: "read",
      argumentsDelta: "x",
    });
    c.flush();
    expect(got).toHaveLength(3);
    expect(got[1]).toMatchObject({
      kind: "tool-call",
      toolCallId: "a",
      argumentsDelta: "}",
    });
    expect(got[2]).toMatchObject({ toolCallId: "b", text: "x" });
  });
});
