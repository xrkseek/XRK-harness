import { describe, expect, it } from "vitest";
import {
  WhenExprError,
  compileWhenExpr,
  evalWhenExpr,
} from "../src/index.js";

describe("when expression", () => {
  it("reads tool name, args, and path with string and regex methods", () => {
    expect(
      evalWhenExpr('name == "bash" && args.command.includes("rm")', {
        kind: "tool.call",
        name: "bash",
        args: { command: "rm -rf tmp" },
      }),
    ).toBe(true);
    expect(
      evalWhenExpr("/passwd/.test(path)", {
        kind: "sidebar.fs",
        op: "read",
        path: "/etc/passwd",
      }),
    ).toBe(true);
    expect(
      evalWhenExpr('url.startsWith("https://")', {
        kind: "sidebar.embed",
        url: "https://example.test",
      }),
    ).toBe(true);
    expect(
      evalWhenExpr("args.command.match(/rm/)", {
        kind: "tool.call",
        name: "bash",
        args: { command: "rm x" },
      }),
    ).toBe(true);
  });

  it("is false when a method receiver is missing, without throwing", () => {
    const pred = compileWhenExpr("args.command.includes('x')");
    expect(pred({ kind: "tool.call", name: "bash" })).toBe(false);
  });

  it("rejects escape hatches at compile time", () => {
    for (const source of [
      "eval(1)",
      "Function('return 1')",
      "process.env",
      "constructor",
      "args.__proto__",
      "globalThis",
    ]) {
      expect(() => compileWhenExpr(source), source).toThrow(WhenExprError);
    }
  });
});
