import { describe, expect, it } from "vitest";
import {
  boundToolOutput,
  createMemoryToolOutputPersist,
  createToolPipeline,
  createToolRegistry,
  runToolDetailed,
} from "../src/index.js";

describe("boundToolOutput", () => {
  it("passes through small content", async () => {
    const out = await boundToolOutput("hello", { maxLines: 10, maxBytes: 100 });
    expect(out.truncated).toBe(false);
    expect(out.content).toBe("hello");
    expect(out.outputPaths).toEqual([]);
  });

  it("truncates by lines with persist marker", async () => {
    const store = createMemoryToolOutputPersist();
    const full = Array.from({ length: 20 }, (_, i) => `line-${i}`).join("\n");
    const out = await boundToolOutput(full, {
      maxLines: 6,
      maxBytes: 10_000,
      persist: (c) => store.persist(c),
    });
    expect(out.truncated).toBe(true);
    expect(out.outputPaths).toHaveLength(1);
    expect(store.read(out.outputPaths[0]!)).toBe(full);
    expect(out.content).toContain("output truncated");
    expect(out.content).toContain(out.outputPaths[0]!);
    expect(out.content.split("\n").length).toBeLessThan(full.split("\n").length);
  });

  it("truncates by bytes", async () => {
    const out = await boundToolOutput("abcdefghij".repeat(20), {
      maxLines: 1000,
      maxBytes: 40,
    });
    expect(out.truncated).toBe(true);
    expect(Buffer.byteLength(out.content, "utf8")).toBeLessThanOrEqual(80);
  });
});

describe("pipeline output bound", () => {
  it("bounds tool results by default", async () => {
    const reg = createToolRegistry();
    reg.register({
      name: "big",
      description: "big",
      parameters: { type: "object", properties: {} },
      async execute() {
        return {
          content: Array.from({ length: 100 }, (_, i) => `L${i}`).join("\n"),
        };
      },
    });
    const store = createMemoryToolOutputPersist();
    const pipeline = createToolPipeline({
      outputBound: {
        maxLines: 8,
        maxBytes: 50_000,
        persist: (c) => store.persist(c),
      },
    });
    const out = await runToolDetailed({
      registry: reg,
      call: { id: "1", name: "big", arguments: {} },
      pipeline,
    });
    expect(out.truncated).toBe(true);
    expect(out.result.content).toContain("truncated");
    expect(out.stages).toContain("bound");
    expect(out.outputPaths?.[0]).toBeTruthy();
  });

  it("can disable output bound", async () => {
    const reg = createToolRegistry();
    const body = Array.from({ length: 100 }, (_, i) => `L${i}`).join("\n");
    reg.register({
      name: "big",
      description: "big",
      parameters: { type: "object", properties: {} },
      async execute() {
        return { content: body };
      },
    });
    const out = await runToolDetailed({
      registry: reg,
      call: { id: "1", name: "big", arguments: {} },
      pipeline: createToolPipeline({ outputBound: false }),
    });
    expect(out.truncated).toBeUndefined();
    expect(out.result.content).toBe(body);
    expect(out.stages).not.toContain("bound");
  });
});
