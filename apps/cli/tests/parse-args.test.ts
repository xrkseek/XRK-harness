import { describe, expect, it } from "vitest";
import { helpText, parseArgs } from "../src/parse-args.js";
import { ensureProductWebDist, harnessAppsRoot, resolveProductWebDist } from "../src/product-paths.js";
import os from "node:os";
import path from "node:path";

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
    expect(a.promptExplicit).toBe(true);
    expect(a.patch).toEqual({ debug: true });
    expect(a.presentation).toBe("tools");
    expect(a.persist).toBe(true);
  });

  it("parses --json and --session-id for run", () => {
    const a = parseArgs([
      "run",
      "--json",
      "--session-id",
      "sess_abc",
      "continue",
    ]);
    expect(a.json).toBe(true);
    expect(a.sessionId).toBe("sess_abc");
    expect(a.prompt).toBe("continue");
    expect(a.promptExplicit).toBe(true);
    expect(a.promptFromStdin).toBe(false);
  });

  it("treats lone - as stdin marker", () => {
    const a = parseArgs(["run", "-"]);
    expect(a.promptFromStdin).toBe(true);
    expect(a.promptExplicit).toBe(false);
    expect(a.prompt).toBe("-");
  });

  it("rejects - mixed with other task words", () => {
    expect(() => parseArgs(["run", "-", "extra"])).toThrow(/only task/);
  });

  it("rejects empty --session-id", () => {
    expect(() => parseArgs(["run", "--session-id", "", "hi"])).toThrow(
      /non-empty/,
    );
  });

  it("treats web as serve", () => {
    const a = parseArgs(["web", "--port", "8080", "--open"]);
    expect(a.command).toBe("serve");
    expect(a.port).toBe(8080);
    expect(a.open).toBe(true);
    expect(a.preset).toBe("harness");
  });

  it("treats Host preset id as web --preset (DSH-style shortcut)", () => {
    const a = parseArgs(["frugal", "--port", "8791", "--open"]);
    expect(a.command).toBe("serve");
    expect(a.preset).toBe("frugal");
    expect(a.port).toBe(8791);
    expect(a.open).toBe(true);
    expect(parseArgs(["shallow"]).preset).toBe("shallow");
    expect(parseArgs(["minimal"]).preset).toBe("minimal");
    expect(parseArgs(["harness"]).preset).toBe("harness");
    expect(parseArgs(["server"]).preset).toBe("server");
    expect(parseArgs(["plan"]).preset).toBe("plan");
  });

  it("lets --preset override a profile shortcut", () => {
    expect(parseArgs(["frugal", "--preset", "minimal"]).preset).toBe("minimal");
  });

  it("rejects unknown first tokens that are not Host presets", () => {
    expect(() => parseArgs(["not-a-preset"])).toThrow(/unknown command/);
    expect(() => parseArgs(["not-a-preset"])).toThrow(/Host preset/);
  });

  it("defaults run to minimal and serve/restart to harness", () => {
    expect(parseArgs(["run", "hi"]).preset).toBe("minimal");
    expect(parseArgs(["serve"]).preset).toBe("harness");
    expect(parseArgs(["restart"]).preset).toBe("harness");
    expect(parseArgs(["restart"]).command).toBe("restart");
    expect(parseArgs(["restart"]).force).toBe(false);
    expect(parseArgs(["web", "--preset", "minimal"]).preset).toBe("minimal");
  });

  it("takes positional prompt", () => {
    const a = parseArgs(["run", "--preset", "minimal", "hello", "world"]);
    expect(a.prompt).toBe("hello world");
    expect(a.promptExplicit).toBe(true);
  });

  it("rejects 0.0.0.0", () => {
    expect(() => parseArgs(["serve", "--host", "0.0.0.0"])).toThrow(/127\.0\.0\.1/);
  });

  it("parses --no-persist and --host", () => {
    const a = parseArgs(["serve", "--no-persist", "--host", "127.0.0.1"]);
    expect(a.persist).toBe(false);
    expect(a.host).toBe("127.0.0.1");
  });

  it("parses restart as its own command; --force stays optional", () => {
    const soft = parseArgs(["restart", "--verbose", "--port", "8799"]);
    expect(soft.command).toBe("restart");
    expect(soft.force).toBe(false);
    expect(soft.verbose).toBe(true);
    expect(soft.port).toBe(8799);

    const hard = parseArgs(["web", "--force", "--port", "8799"]);
    expect(hard.command).toBe("serve");
    expect(hard.force).toBe(true);
  });

  it("parses plugin and keeps remaining argv", () => {
    const a = parseArgs([
      "plugin",
      "add",
      "@huanlin/dsh-plugin-spur",
      "./local",
    ]);
    expect(a.command).toBe("plugin");
    expect(a.pluginArgv).toEqual([
      "add",
      "@huanlin/dsh-plugin-spur",
      "./local",
    ]);
  });

  it("parses skill and keeps remaining argv (flags are subcommand-scoped)", () => {
    const a = parseArgs([
      "skill",
      "add",
      "./skills/office-ping",
      "--force",
      "--workspace",
      ".",
    ]);
    expect(a.command).toBe("skill");
    expect(a.skillArgv).toEqual([
      "add",
      "./skills/office-ping",
      "--force",
      "--workspace",
      ".",
    ]);
    // `skill` owns its argv, so top-level flags stay untouched.
    expect(a.pluginArgv).toEqual([]);
    expect(a.force).toBe(false);
  });

  it("parses mcp and keeps remaining argv (subcommand + server + flags)", () => {
    const a = parseArgs([
      "mcp",
      "login",
      "linear",
      "--client-id",
      "xrk-cli",
      "--json",
    ]);
    expect(a.command).toBe("mcp");
    expect(a.mcpArgv).toEqual([
      "login",
      "linear",
      "--client-id",
      "xrk-cli",
      "--json",
    ]);
    // `mcp` owns its argv, so sibling buckets stay empty and top-level flags
    // are not stolen from the subcommand parser.
    expect(a.skillArgv).toEqual([]);
    expect(a.pluginArgv).toEqual([]);
    expect(a.force).toBe(false);
  });

  it("help text mentions web and persist", () => {
    expect(helpText()).toContain("xrkh —");
    expect(helpText()).toContain("doctor");
    expect(helpText()).toContain("web");
    expect(helpText()).toContain("restart");
    expect(helpText()).toContain("plugin");
    expect(helpText()).toContain("skill");
    expect(helpText()).toContain("mcp");
    expect(helpText()).toContain("acp");
    expect(helpText()).toContain("--force");
    expect(helpText()).toContain("--verbose");
    expect(helpText()).toContain("--no-persist");
    expect(helpText()).toContain("~/.xrk/sessions");
    expect(helpText()).toContain("127.0.0.1");
  });

  it("parses bare --version", () => {
    const a = parseArgs(["--version"]);
    expect(a.version).toBe(true);
  });
});

describe("product paths", () => {
  it("sessions default under ~/.xrk", async () => {
    const { defaultSessionsDir, resolveXrkHome } = await import("@xrkseek/server-config");
    expect(defaultSessionsDir()).toBe(path.join(resolveXrkHome(), "sessions"));
  });

  it("apps root sits next to cli package", () => {
    expect(harnessAppsRoot()).toMatch(/apps$/);
  });

  it("resolves product shell dist when present", async () => {
    const dir = await resolveProductWebDist();
    if (!dir) return;
    expect(dir.replaceAll("\\", "/")).toMatch(/\/(web\/dist|product-web)$/);
  });

  it("ensureProductWebDist rejects a missing configured path without building", async () => {
    const missing = path.join(os.tmpdir(), "xrk-no-web-dist", String(Date.now()));
    await expect(ensureProductWebDist(missing)).rejects.toThrow(/product UI not found/);
  });
});
