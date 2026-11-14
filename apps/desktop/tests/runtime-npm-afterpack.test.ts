import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { copyDesktopRuntimeNpm } from "../scripts/electron-builder-config.mjs";

const temps: string[] = [];

afterEach(() => {
  for (const dir of temps.splice(0)) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
});

describe("copyDesktopRuntimeNpm", () => {
  it("re-copies vendored npm into the packaged runtime/node tree", () => {
    const root = mkdtempSync(path.join(tmpdir(), "xrk-rt-npm-"));
    temps.push(root);
    const prepared = path.join(root, "prepared", "node");
    const packaged = path.join(root, "packaged", "node");
    const npmCli = path.join(prepared, "node_modules", "npm", "bin", "npm-cli.js");
    mkdirSync(path.dirname(npmCli), { recursive: true });
    writeFileSync(npmCli, "#!/usr/bin/env node\nconsole.log('npm')\n");
    writeFileSync(path.join(prepared, "npm.cmd"), "@ECHO OFF\n");
    writeFileSync(path.join(prepared, "node.exe"), "fake");
    // Packaged tree as electron-builder leaves it: node only, no node_modules.
    mkdirSync(packaged, { recursive: true });
    writeFileSync(path.join(packaged, "node.exe"), "fake");

    copyDesktopRuntimeNpm(prepared, packaged);

    const destCli = path.join(
      packaged,
      "node_modules",
      "npm",
      "bin",
      "npm-cli.js",
    );
    expect(existsSync(destCli)).toBe(true);
    expect(readFileSync(destCli, "utf8")).toContain("npm");
    expect(existsSync(path.join(packaged, "npm.cmd"))).toBe(true);
  });

  it("throws when prepare:runtime did not vendor npm", () => {
    const root = mkdtempSync(path.join(tmpdir(), "xrk-rt-npm-miss-"));
    temps.push(root);
    const prepared = path.join(root, "prepared", "node");
    const packaged = path.join(root, "packaged", "node");
    mkdirSync(prepared, { recursive: true });
    mkdirSync(packaged, { recursive: true });
    expect(() => copyDesktopRuntimeNpm(prepared, packaged)).toThrow(/vendored npm missing/);
  });
});
