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

  it("parses presentation code", () => {
    const a = parseArgs(["run", "--presentation", "code"]);
    expect(a.presentation).toBe("code");
  });

  it("treats web as serve", () => {
    const a = parseArgs(["web", "--port", "8080", "--open"]);
    expect(a.command).toBe("serve");
    expect(a.port).toBe(8080);
    expect(a.open).toBe(true);
    expect(a.preset).toBe("harness");
  });

  it("defaults run to minimal and serve/restart to harness", () => {
    expect(parseArgs(["run", "hi"]).preset).toBe("minimal");
    expect(parseArgs(["serve"]).preset).toBe("harness");
    expect(parseArgs(["restart"]).preset).toBe("harness");
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

  it("parses --force --verbose and restart", () => {
    const a = parseArgs(["restart", "--force", "--verbose", "--port", "8799"]);
    expect(a.command).toBe("restart");
    expect(a.force).toBe(true);
    expect(a.verbose).toBe(true);
    expect(a.port).toBe(8799);
  });

  it("help text mentions web and persist", () => {
    expect(helpText()).toContain("doctor");
    expect(helpText()).toContain("web");
    expect(helpText()).toContain("restart");
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
