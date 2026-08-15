import { describe, expect, it } from "vitest";
import { helpText, parseArgs } from "../src/parse-args.js";

describe("cli parseArgs", () => {
  it("parses run flags", () => {
    const a = parseArgs([
      "run",
      "--preset",
      "minimal",
      "--prompt",
      "hi",
      "--workspace",
      ".",
      "--patch",
      '{"debug":true}',
    ]);
    expect(a.command).toBe("run");
    expect(a.preset).toBe("minimal");
    expect(a.prompt).toBe("hi");
    expect(a.patch).toEqual({ debug: true });
    expect(a.presentation).toBe("tools");
  });

  it("parses presentation code", () => {
    const a = parseArgs(["run", "--presentation", "code"]);
    expect(a.presentation).toBe("code");
  });

  it("help text mentions doctor", () => {
    expect(helpText()).toContain("doctor");
  });
});
