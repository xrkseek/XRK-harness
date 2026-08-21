import { describe, expect, it } from "vitest";
import type { SessionEvent } from "@xrkseek/protocol";
import {
  expandPackedStorageRecords,
  fromPackedJSONL,
  fromPackedJSONLZstd,
  packChunkRunsForExport,
  parsePackedJSONL,
  toPackedJSONL,
  zstdCompressUtf8,
} from "../src/chunk-pack.js";

function chunk(ts: number, text: string): SessionEvent {
  return {
    type: "assistant/chunk",
    ts,
    turnId: "t1",
    stepId: "s1",
    text,
    kind: "text",
    index: 1,
  };
}

describe("chunk-pack export", () => {
  it("passes through non-chunk events", () => {
    const events: SessionEvent[] = [
      { type: "turn/start", ts: 1, turnId: "t1" },
      { type: "user/message", ts: 2, turnId: "t1", content: "hi" },
    ];
    expect(packChunkRunsForExport(events)).toEqual(events);
  });

  it("packs runs of three or more consecutive same-block chunks", () => {
    const events = [chunk(1, "a"), chunk(2, "b"), chunk(4, "c")];
    const packed = packChunkRunsForExport(events);
    expect(packed).toHaveLength(1);
    expect(packed[0]).toMatchObject({
      type: "text-chunks",
      texts: ["a", "b", "c"],
      dts: [1, 2],
    });
    expect(expandPackedStorageRecords(packed)).toEqual(events);
  });

  it("packs tool-call argument deltas into tool-call-chunks", () => {
    const events: SessionEvent[] = [1, 2, 3].map((n) => ({
      type: "assistant/chunk" as const,
      ts: n,
      turnId: "t1",
      stepId: "s1",
      text: `{"a":${n}`,
      kind: "tool-call" as const,
      index: 0,
      toolCallId: "c1",
      toolName: "echo",
      argumentsDelta: `{"a":${n}`,
    }));
    const packed = packChunkRunsForExport(events);
    expect(packed).toHaveLength(1);
    expect(packed[0]).toMatchObject({
      type: "tool-call-chunks",
      toolCallId: "c1",
      toolName: "echo",
      args: ['{"a":1', '{"a":2', '{"a":3'],
    });
    expect(expandPackedStorageRecords(packed)).toEqual(events);
  });

  it("keeps short runs verbatim", () => {
    const events = [chunk(1, "a"), chunk(2, "b")];
    expect(packChunkRunsForExport(events)).toEqual(events);
  });

  it("toPackedJSONL emits one line per storage record", () => {
    const jsonl = toPackedJSONL([
      chunk(1, "x"),
      chunk(2, "y"),
      chunk(3, "z"),
    ]);
    expect(jsonl.split("\n").filter(Boolean)).toHaveLength(1);
    expect(jsonl).toContain('"type":"text-chunks"');
  });

  it("fromPackedJSONL round-trips packed export", () => {
    const events = [chunk(1, "a"), chunk(2, "b"), chunk(3, "c")];
    const jsonl = toPackedJSONL(events);
    expect(fromPackedJSONL(jsonl)).toEqual(events);
    expect(parsePackedJSONL(jsonl).droppedTrailingIncomplete).toBe(false);
  });

  it("zstd sidecar round-trips", () => {
    const events = [chunk(1, "z"), chunk(2, "s"), chunk(3, "t")];
    const packed = toPackedJSONL(events);
    const zst = zstdCompressUtf8(packed);
    expect(fromPackedJSONLZstd(zst)).toEqual(events);
  });
});
