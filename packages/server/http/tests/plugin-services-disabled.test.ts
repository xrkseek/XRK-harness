import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  readXrkDisabledPluginIds,
  readXrkPluginInventory,
} from "../src/xrk/plugin-services.js";

const temps: string[] = [];

afterEach(() => {
  for (const dir of temps.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("xrk plugin-services soft-disable", () => {
  it("reads soft-disabled ids for market / inventory adapters", () => {
    const root = mkdtempSync(path.join(tmpdir(), "xrk-http-dis-"));
    temps.push(root);
    mkdirSync(root, { recursive: true });
    writeFileSync(
      path.join(root, ".xrk-plugins.json"),
      JSON.stringify({
        rev: 1,
        packages: {
          side: {
            name: "side",
            version: "1.0.0",
            kind: "client",
          },
        },
      }),
    );
    writeFileSync(
      path.join(root, ".xrk-plugins-disabled.json"),
      `${JSON.stringify({ ids: ["side", "  ghost  "] }, null, 2)}\n`,
    );
    expect(readXrkDisabledPluginIds({ pluginsDir: root })).toEqual([
      "ghost",
      "side",
    ]);
    expect(readXrkPluginInventory({ pluginsDir: root }).present).toEqual([
      "side",
    ]);
  });
});
