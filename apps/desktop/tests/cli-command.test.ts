import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  applyCliCommandLink,
  mergePosixProfile,
  prependPathEntry,
  readCliCommandEnabled,
  removePathEntry,
} from "../src/cli-command.js";

const dirs: string[] = [];

afterEach(() => {
  while (dirs.length > 0) rmSync(dirs.pop()!, { recursive: true, force: true });
});

describe("cli command link", () => {
  it("defaults to linked when the pref is missing", () => {
    expect(readCliCommandEnabled(undefined)).toBe(true);
    expect(readCliCommandEnabled('{"link":false}')).toBe(false);
  });

  it("prepends the shim dir once and rewrites xrkh to the bundled binary", () => {
    const home = mkdtempSync(path.join(tmpdir(), "xrk-cli-link-"));
    dirs.push(home);
    let userPath = "C:\\npm;C:\\Windows";
    const result = applyCliCommandLink({
      xrkHome: home,
      nodePath: "C:\\XRK\\node.exe",
      cliBinPath: "C:\\XRK\\bin.js",
      platform: "win32",
      enabled: true,
      readUserPath: () => userPath,
      writeUserPath: (next) => {
        userPath = next;
      },
    });
    expect(result.linked).toBe(true);
    expect(userPath.startsWith(`${result.binDir};`)).toBe(true);
    const cmd = readFileSync(path.join(result.binDir, "xrkh.cmd"), "utf8");
    expect(cmd).toContain("XRK_DESKTOP_CLI_SHIM");
    expect(cmd).toContain("C:\\XRK\\bin.js");
    expect(existsSync(path.join(result.binDir, "xrkh.ps1"))).toBe(false);
    applyCliCommandLink({
      xrkHome: home,
      nodePath: "C:\\XRK\\node.exe",
      cliBinPath: "C:\\XRK\\bin.js",
      platform: "win32",
      enabled: true,
      readUserPath: () => userPath,
      writeUserPath: (next) => {
        userPath = next;
      },
    });
    expect(userPath.split(";").filter((part) => part === result.binDir)).toHaveLength(1);
  });

  it("removes only the owned shim dir from PATH when disabled", () => {
    const home = mkdtempSync(path.join(tmpdir(), "xrk-cli-off-"));
    dirs.push(home);
    const bin = path.join(home, "bin");
    let userPath = `${bin};C:\\npm`;
    applyCliCommandLink({
      xrkHome: home,
      nodePath: "C:\\XRK\\node.exe",
      cliBinPath: "C:\\XRK\\bin.js",
      platform: "win32",
      enabled: false,
      readUserPath: () => userPath,
      writeUserPath: (next) => {
        userPath = next;
      },
    });
    expect(userPath).toBe("C:\\npm");
    expect(prependPathEntry("a;b", "a", "win32")).toBe("a;b");
    expect(removePathEntry("A;b", "a", "win32")).toBe("b");
  });

  it("rewrites the marked block in a shell profile", () => {
    const once = mergePosixProfile("echo hi\n", "/home/me/.xrk/bin", true);
    expect(once).toContain('export PATH="/home/me/.xrk/bin:$PATH"');
    const twice = mergePosixProfile(once, "/home/me/.xrk/bin", true);
    expect(twice.match(/XRK_DESKTOP_CLI_SHIM/g)).toHaveLength(2);
    expect(mergePosixProfile(twice, "/home/me/.xrk/bin", false)).toBe("echo hi\n");
  });

  it("quotes the bundled node path for macOS and Linux shims", () => {
    const home = mkdtempSync(path.join(tmpdir(), "xrk-cli-posix-"));
    dirs.push(home);
    const result = applyCliCommandLink({
      xrkHome: home,
      nodePath: "/Users/me/App Node/node",
      cliBinPath: "/Users/me/XRK/bin.js",
      platform: "darwin",
      enabled: true,
      readUserPath: () => "/usr/bin",
      writeUserPath: () => {},
    });
    const shim = readFileSync(path.join(result.binDir, "xrkh"), "utf8");
    expect(shim.startsWith("#!/bin/sh\n")).toBe(true);
    expect(shim).toContain("exec '/Users/me/App Node/node' '/Users/me/XRK/bin.js'");
  });
});
