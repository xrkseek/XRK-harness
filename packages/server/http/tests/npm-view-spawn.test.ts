import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildNpmViewVersionArgs,
  isNpmViewHttpUrl,
  normalizeNpmViewNet,
  planNpmViewSpawn,
} from "../src/xrk/npm-view-spawn.js";

const temps: string[] = [];

afterEach(() => {
  for (const dir of temps.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("normalizeNpmViewNet / buildNpmViewVersionArgs", () => {
  it("keeps only http(s) registry and proxy", () => {
    expect(isNpmViewHttpUrl("https://registry.npmmirror.com/")).toBe(true);
    expect(isNpmViewHttpUrl("--registry=evil")).toBe(false);
    expect(
      normalizeNpmViewNet({
        registry: "https://registry.npmmirror.com/",
        proxy: "http://127.0.0.1:7897",
      }),
    ).toEqual({
      registry: "https://registry.npmmirror.com/",
      proxy: "http://127.0.0.1:7897",
    });
    expect(
      normalizeNpmViewNet({
        registry: "--registry=http://evil",
        proxy: "not-a-url",
      }),
    ).toEqual({});
    expect(
      buildNpmViewVersionArgs("xrkh-better-sidebar", {
        registry: "https://registry.npmmirror.com/",
        proxy: "ftp://bad",
      }),
    ).toEqual([
      "view",
      "xrkh-better-sidebar",
      "version",
      "--registry",
      "https://registry.npmmirror.com/",
    ]);
  });
});

describe("planNpmViewSpawn", () => {
  it("routes Windows npm.cmd through ComSpec (never bare .cmd spawn)", () => {
    const plan = planNpmViewSpawn(["view", "xrkh-better-sidebar", "version"], {
      execPath: "C:\\fake\\node.exe",
      platform: "win32",
      env: { ComSpec: "C:\\Windows\\System32\\cmd.exe" },
    });
    expect(plan.file.toLowerCase()).toContain("cmd.exe");
    expect(plan.args.slice(0, 3)).toEqual(["/d", "/s", "/c"]);
    expect(plan.args[3]).toContain("npm.cmd");
    expect(plan.args[3]).toContain("view");
    expect(plan.windowsVerbatimArguments).toBe(true);
  });

  it("uses node + npm-cli.js when vendored next to execPath", () => {
    const home = mkdtempSync(join(tmpdir(), "xrk-http-npm-cli-"));
    temps.push(home);
    const cli = join(home, "node_modules", "npm", "bin", "npm-cli.js");
    mkdirSync(join(home, "node_modules", "npm", "bin"), { recursive: true });
    writeFileSync(cli, "/* npm */\n");
    const node = join(home, "node.exe");
    writeFileSync(node, "");
    const plan = planNpmViewSpawn(["view", "pkg", "version"], {
      execPath: node,
      platform: "win32",
      env: { ComSpec: "cmd.exe" },
    });
    expect(plan.file).toBe(node);
    expect(plan.args[0]).toBe(cli);
    expect(plan.args.slice(1)).toEqual(["view", "pkg", "version"]);
    expect(plan.windowsVerbatimArguments).toBeUndefined();
  });
});
