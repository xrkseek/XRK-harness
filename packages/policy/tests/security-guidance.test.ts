import { describe, expect, it, vi } from "vitest";
import {
  createToolPipeline,
  createToolRegistry,
  runToolDetailed,
} from "@xrkseek/core-tools";
import {
  createWritePathSecurityPost,
  createWritePathSecurityPre,
  matchSensitiveWritePath,
  scanWritePathSecurity,
} from "../src/security-guidance.js";

describe("write-path security guidance", () => {
  it("flags sensitive destinations", () => {
    expect(matchSensitiveWritePath("src/.env")?.id).toBe("dot-env");
    expect(matchSensitiveWritePath("home/.ssh/id_rsa")?.id).toBe("ssh-dir");
    expect(matchSensitiveWritePath("src/ok.ts")).toBeUndefined();
  });

  it("scans write content for eval / pickle", () => {
    const findings = scanWritePathSecurity("write_file", {
      path: "app.ts",
      content: "const x = eval(userInput);",
    });
    expect(findings.some((f) => f.id === "eval_injection")).toBe(true);

    const py = scanWritePathSecurity("write_file", {
      path: "load.py",
      content: "data = pickle.loads(blob)",
    });
    expect(py.some((f) => f.id === "pickle_load")).toBe(true);
  });

  it("pre denies .env writes before body", async () => {
    const body = vi.fn(async () => ({ content: "wrote" }));
    const reg = createToolRegistry();
    reg.register({
      name: "write_file",
      description: "w",
      parameters: {},
      execute: body,
    });
    const pipeline = createToolPipeline();
    pipeline.onPre(createWritePathSecurityPre({ env: {} }));
    pipeline.onPre(() => ({ action: "continue", args: {} })); // faux policy allow
    const out = await runToolDetailed({
      registry: reg,
      call: {
        id: "1",
        name: "write_file",
        arguments: { path: ".env", content: "K=v" },
      },
      pipeline,
    });
    expect(body).not.toHaveBeenCalled();
    expect(String(out.result.content)).toMatch(/\.env/i);
  });

  it("post appends advisory on eval write", async () => {
    const reg = createToolRegistry();
    reg.register({
      name: "write_file",
      description: "w",
      parameters: {},
      execute: async () => ({ content: "ok" }),
    });
    const pipeline = createToolPipeline();
    pipeline.onPost(createWritePathSecurityPost({ env: {} }));
    const out = await runToolDetailed({
      registry: reg,
      call: {
        id: "1",
        name: "write_file",
        arguments: {
          path: "x.ts",
          content: "eval(code)",
        },
      },
      pipeline,
    });
    expect(String(out.result.content)).toMatch(/Security guidance/);
    expect(String(out.result.content)).toMatch(/eval/);
  });

  it("block mode refuses content on pre", async () => {
    const body = vi.fn(async () => ({ content: "wrote" }));
    const reg = createToolRegistry();
    reg.register({
      name: "write_file",
      description: "w",
      parameters: {},
      execute: body,
    });
    const pipeline = createToolPipeline();
    pipeline.onPre(
      createWritePathSecurityPre({
        env: { XRK_SECURITY_GUIDANCE_BLOCK: "1" },
      }),
    );
    const out = await runToolDetailed({
      registry: reg,
      call: {
        id: "1",
        name: "write_file",
        arguments: { path: "x.ts", content: "eval(x)" },
      },
      pipeline,
    });
    expect(body).not.toHaveBeenCalled();
    expect(String(out.result.content)).toMatch(/refused/i);
  });
});
