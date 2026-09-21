import { describe, expect, it } from "vitest";
import {
  boundCodeOutput,
  clampCodeTimeout,
  createRunCodeTool,
  createWorkerCodeRuntime,
  DEFAULT_CODE_MAX_TIMEOUT_MS,
  DEFAULT_CODE_TIMEOUT_MS,
} from "../src/index.js";

describe("code-runtime", () => {
  it("runs a snippet and captures console.log", async () => {
    const runtime = createWorkerCodeRuntime({ timeoutMs: 3000 });
    const out = await runtime.run(`console.log('hi'); return 1+1;`);
    expect(out.error).toBeUndefined();
    expect(out.stdout).toContain("hi");
    expect(out.stdout).toContain("2");
  });

  it("exposes run_code tool", async () => {
    const tool = createRunCodeTool(createWorkerCodeRuntime({ timeoutMs: 3000 }));
    expect(tool.name).toBe("run_code");
    const result = await tool.execute({ source: "return 'ok'" });
    expect(result.isError).toBeUndefined();
    expect(result.content).toContain("ok");
  });

  it("times out runaway code", async () => {
    const runtime = createWorkerCodeRuntime({ timeoutMs: 100 });
    const out = await runtime.run(`while(true){}`);
    expect(out.error).toMatch(/timeout/);
  });

  it("clampCodeTimeout applies default and max", () => {
    expect(clampCodeTimeout(undefined, 120_000, 600_000)).toBe(120_000);
    expect(clampCodeTimeout(900_000, 120_000, 600_000)).toBe(600_000);
    expect(clampCodeTimeout(5_000, 120_000, 600_000)).toBe(5_000);
    expect(() => clampCodeTimeout(0, 120_000, 600_000)).toThrow(/positive/);
  });

  it("runtime.timeout exposes default and max", () => {
    const runtime = createWorkerCodeRuntime({
      timeoutMs: 30_000,
      maxTimeoutMs: 90_000,
    });
    expect(runtime.timeout).toEqual({ defaultMs: 30_000, maxMs: 90_000 });
    expect(DEFAULT_CODE_TIMEOUT_MS).toBe(120_000);
    expect(DEFAULT_CODE_MAX_TIMEOUT_MS).toBe(600_000);
  });

  it("honors per-call timeoutMs clamped to max", async () => {
    const runtime = createWorkerCodeRuntime({
      timeoutMs: 5_000,
      maxTimeoutMs: 200,
    });
    const out = await runtime.run(`while(true){}`, undefined, {
      timeoutMs: 10_000,
    });
    expect(out.error).toMatch(/timeout after 200ms/);
  });

  it("run_code schema documents timeoutMs and rejects zero", async () => {
    const tool = createRunCodeTool(
      createWorkerCodeRuntime({ timeoutMs: 1000, maxTimeoutMs: 2000 }),
    );
    const props = tool.parameters.properties as {
      timeoutMs: { description: string };
    };
    expect(props.timeoutMs.description).toMatch(/Default 1000/);
    expect(props.timeoutMs.description).toMatch(/capped at 2000/);
    const bad = await tool.execute({ source: "return 1", timeoutMs: 0 });
    expect(bad.isError).toBe(true);
    expect(String(bad.content)).toMatch(/positive/);
  });

  it("bounds oversized stdout", async () => {
    const runtime = createWorkerCodeRuntime({
      timeoutMs: 3000,
      maxOutputBytes: 64,
    });
    const out = await runtime.run(
      `console.log(${JSON.stringify("x".repeat(200))}); return 'done';`,
    );
    expect(out.error).toBeUndefined();
    expect(out.truncated).toBe(true);
    expect(Buffer.byteLength(out.stdout, "utf8")).toBeLessThanOrEqual(64);
    expect(out.stdout).toContain("[truncated]");
  });

  it("boundCodeOutput preserves short text", () => {
    expect(boundCodeOutput("hello", 64)).toEqual({
      text: "hello",
      truncated: false,
    });
  });

  it("rejects invalid construction caps", () => {
    expect(() => createWorkerCodeRuntime({ maxOutputBytes: 2 })).toThrow(
      /maxOutputBytes/,
    );
    expect(() => createWorkerCodeRuntime({ timeoutMs: 0 })).toThrow(/timeoutMs/);
  });
});
