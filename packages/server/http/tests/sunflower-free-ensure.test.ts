import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  findSunflowerFreePluginRoot,
  resolveSunflowerFreePluginRoot,
  SUNFLOWER_FREE_PLUGIN_ID,
} from "../src/sunflower-free/ensure.js";

const temps: string[] = [];

afterEach(() => {
  delete process.env.XRK_SUNFLOWER_FREE_ROOT;
  for (const d of temps.splice(0)) {
    rmSync(d, { recursive: true, force: true });
  }
});

function plantFakeCliLayout(): { packageRoot: string; distDir: string; pluginRoot: string } {
  const packageRoot = mkdtempSync(path.join(tmpdir(), "sf-cli-"));
  temps.push(packageRoot);
  const distDir = path.join(packageRoot, "dist");
  const pluginRoot = path.join(
    packageRoot,
    "extensions",
    SUNFLOWER_FREE_PLUGIN_ID,
  );
  mkdirSync(distDir, { recursive: true });
  mkdirSync(pluginRoot, { recursive: true });
  writeFileSync(
    path.join(pluginRoot, "xrk.plugin.json"),
    JSON.stringify({ id: SUNFLOWER_FREE_PLUGIN_ID, kind: "llm" }),
  );
  writeFileSync(path.join(distDir, "bin.js"), "export {};\n");
  return { packageRoot, distDir, pluginRoot };
}

describe("sunflower-free ensure discovery", () => {
  it("finds extensions next to a packaged CLI root when started from dist/", () => {
    const { distDir, pluginRoot } = plantFakeCliLayout();
    expect(findSunflowerFreePluginRoot(distDir)).toBe(pluginRoot);
  });

  it("honors XRK_SUNFLOWER_FREE_ROOT", () => {
    const { pluginRoot } = plantFakeCliLayout();
    process.env.XRK_SUNFLOWER_FREE_ROOT = pluginRoot;
    expect(resolveSunflowerFreePluginRoot(tmpdir())).toBe(pluginRoot);
  });

  it("returns undefined when no extensions tree exists", () => {
    const empty = mkdtempSync(path.join(tmpdir(), "sf-empty-"));
    temps.push(empty);
    expect(findSunflowerFreePluginRoot(empty)).toBeUndefined();
  });
});
