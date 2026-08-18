import { describe, expect, it } from "vitest";
import { encodeMessage, MessageDecoder } from "../src/index.js";

describe("LSP framing", () => {
  it("round-trips a JSON-RPC body", () => {
    const decoder = new MessageDecoder(1024);
    const framed = encodeMessage({ jsonrpc: "2.0", id: 1, method: "initialize" });
    expect(decoder.push(framed)).toEqual([
      { jsonrpc: "2.0", id: 1, method: "initialize" },
    ]);
  });

  it("reassembles split chunks", () => {
    const decoder = new MessageDecoder(1024);
    const framed = encodeMessage({ ok: true });
    expect(decoder.push(framed.subarray(0, 8))).toEqual([]);
    expect(decoder.push(framed.subarray(8))).toEqual([{ ok: true }]);
  });

  it("rejects oversized bodies", () => {
    const decoder = new MessageDecoder(4);
    expect(() => decoder.push(encodeMessage({ hello: "world" }))).toThrow(
      /exceeds the 4-byte limit/,
    );
  });
});
