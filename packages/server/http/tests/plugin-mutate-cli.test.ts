import { describe, expect, it } from "vitest";
import {
  cliInvocationNeedsShell,
  listCliInvocationCandidates,
  planCliInvocation,
  quoteWindowsCmdArg,
} from "../src/xrk/plugin-mutate.js";

describe("listCliInvocationCandidates", () => {
  it("lists win32 shims with xrkh.cmd before legacy xrk-harness.cmd", () => {
    const shims = listCliInvocationCandidates(
      { PATH: "C:\\Windows" },
      "win32",
    ).filter((c) => c.prefixArgs.length === 0);
    expect(shims.map((c) => c.command)).toEqual([
      "xrkh.cmd",
      "xrk-harness.cmd",
    ]);
  });

  it("lists unix shims with xrkh before legacy xrk-harness", () => {
    const shims = listCliInvocationCandidates(
      { PATH: "/usr/bin" },
      "linux",
    ).filter((c) => c.prefixArgs.length === 0);
    expect(shims.map((c) => c.command)).toEqual(["xrkh", "xrk-harness"]);
  });

  it("ignores missing XRK_HARNESS_BIN .js paths", () => {
    const candidates = listCliInvocationCandidates(
      {
        PATH: "/usr/bin",
        XRK_HARNESS_BIN: "/no/such/xrk-harness-bin.js",
      },
      "linux",
    );
    expect(
      candidates.some((c) =>
        c.prefixArgs.some((a) => a.includes("xrk-harness-bin.js")),
      ),
    ).toBe(false);
  });
});

describe("quoteWindowsCmdArg", () => {
  it("leaves simple tokens alone", () => {
    expect(quoteWindowsCmdArg("plugin")).toBe("plugin");
    expect(quoteWindowsCmdArg("xrkh-better-sidebar@0.18.2")).toBe(
      "xrkh-better-sidebar@0.18.2",
    );
  });

  it("quotes spaces and metacharacters", () => {
    expect(quoteWindowsCmdArg("C:\\Program Files\\nodejs\\node.exe")).toBe(
      '"C:\\Program Files\\nodejs\\node.exe"',
    );
    expect(quoteWindowsCmdArg("a&b")).toBe('"a&b"');
  });
});

describe("planCliInvocation", () => {
  it("runs node + bin.js directly (Program Files / Unicode-safe)", () => {
    const plan = planCliInvocation(
      {
        command: "C:\\Program Files\\nodejs\\node.exe",
        prefixArgs: [
          "C:\\Users\\x\\Desktop\\主仓库\\XRK-harness\\apps\\cli\\dist\\bin.js",
        ],
      },
      ["plugin", "add", "xrkh-better-sidebar@0.18.2"],
      "win32",
    );
    expect(plan.file).toBe("C:\\Program Files\\nodejs\\node.exe");
    expect(plan.args).toEqual([
      "C:\\Users\\x\\Desktop\\主仓库\\XRK-harness\\apps\\cli\\dist\\bin.js",
      "plugin",
      "add",
      "xrkh-better-sidebar@0.18.2",
    ]);
    expect(plan.windowsVerbatimArguments).toBeUndefined();
  });

  it("routes Windows .cmd shims through ComSpec without shell:true", () => {
    const plan = planCliInvocation(
      { command: "xrkh.cmd", prefixArgs: [] },
      ["plugin", "add", "pkg@1.0.0"],
      "win32",
      { ComSpec: "C:\\Windows\\System32\\cmd.exe" },
    );
    expect(plan.file).toBe("C:\\Windows\\System32\\cmd.exe");
    expect(plan.args[0]).toBe("/d");
    expect(plan.args[1]).toBe("/s");
    expect(plan.args[2]).toBe("/c");
    expect(plan.args[3]).toBe("xrkh.cmd plugin add pkg@1.0.0");
    expect(plan.windowsVerbatimArguments).toBe(true);
  });

  it("quotes spaced specs inside the cmd line", () => {
    const plan = planCliInvocation(
      { command: "xrkh.cmd", prefixArgs: [] },
      ["plugin", "add", "C:\\My Plugins\\side"],
      "win32",
      { ComSpec: "cmd.exe" },
    );
    expect(plan.args[3]).toBe(
      'xrkh.cmd plugin add "C:\\My Plugins\\side"',
    );
  });

  it("uses direct argv on unix (including paths with spaces)", () => {
    const plan = planCliInvocation(
      {
        command: "/usr/local/bin/node",
        prefixArgs: ["/home/user/My Apps/cli/dist/bin.js"],
      },
      ["plugin", "remove", "side"],
      "linux",
    );
    expect(plan).toEqual({
      file: "/usr/local/bin/node",
      args: [
        "/home/user/My Apps/cli/dist/bin.js",
        "plugin",
        "remove",
        "side",
      ],
    });
  });

  it("uses direct argv for unix PATH shims", () => {
    expect(
      planCliInvocation(
        { command: "xrkh", prefixArgs: [] },
        ["plugin", "list"],
        "darwin",
      ),
    ).toEqual({
      file: "xrkh",
      args: ["plugin", "list"],
    });
  });
});

describe("cliInvocationNeedsShell", () => {
  it("always returns false (shell never used)", () => {
    expect(
      cliInvocationNeedsShell(
        {
          command: "C:\\Program Files\\nodejs\\node.exe",
          prefixArgs: ["bin.js"],
        },
        "win32",
      ),
    ).toBe(false);
    expect(
      cliInvocationNeedsShell({ command: "xrkh.cmd", prefixArgs: [] }, "win32"),
    ).toBe(false);
    expect(
      cliInvocationNeedsShell({ command: "xrkh", prefixArgs: [] }, "linux"),
    ).toBe(false);
  });
});
