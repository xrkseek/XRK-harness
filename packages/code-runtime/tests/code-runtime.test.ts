import { describe, expect, it } from "vitest";
import { createRunCodeTool, createWorkerCodeRuntime } from "../src/index.js";

describe("code-runtime", () => {
  it("runs a snippet and captures console.log", async () => {
    const runtime = createWorkerCodeRuntime({ timeoutMs: 3000 });
    const out = await runtime.run(`console.log('hi'); return 1+1;`);
    expect(out.error).toBeUndefined();
    expect(out.stdout).toContain("hi");
    expect(out.stdout).toContain("2");
  });

  it("exposes run_code tool", async () => {
    const tool = createRunCodeTool(createWorkerCodeRuntime());
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
});
