import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  reconcileManagedClientBoot,
  resolveManagedPluginDir,
  writeDisabledPluginIds,
} from "../src/plugin-inventory.js";

const temps: string[] = [];

afterEach(() => {
  for (const dir of temps.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function runtimeAt(productDir: string) {
  return { productDir } as never;
}

describe("managed plugin inventory paths", () => {
  it("resolves client halves under web/plugins", () => {
    const productDir = mkdtempSync(path.join(tmpdir(), "xrk-inv-"));
    temps.push(productDir);
    const staged = path.join(
      productDir,
      "plugins",
      "web",
      "plugins",
      "xrkh-better-sidebar",
    );
    mkdirSync(staged, { recursive: true });
    writeFileSync(path.join(staged, "client.js"), "export {}\n");
    expect(
      resolveManagedPluginDir(
        runtimeAt(productDir),
        "xrkh-better-sidebar",
        "xrkh-better-sidebar",
      ),
    ).toBe(staged);
  });

  it("drops soft-disabled client packages from web/boot.json", () => {
    const productDir = mkdtempSync(path.join(tmpdir(), "xrk-boot-"));
    temps.push(productDir);
    const plugins = path.join(productDir, "plugins");
    mkdirSync(path.join(plugins, "web", "plugins", "keep-me"), {
      recursive: true,
    });
    writeFileSync(
      path.join(plugins, ".xrk-plugins.json"),
      JSON.stringify({
        rev: 1,
        packages: {
          "keep-me": {
            name: "keep-me",
            version: "1.0.0",
            kind: "client",
            source: "keep-me@1.0.0",
            installedAt: new Date().toISOString(),
            clientInject: [],
          },
          "drop-me": {
            name: "drop-me",
            version: "1.0.0",
            kind: "client",
            source: "drop-me@1.0.0",
            installedAt: new Date().toISOString(),
            clientInject: [],
          },
        },
      }),
    );
    writeDisabledPluginIds(runtimeAt(productDir), new Set(["drop-me"]));
    reconcileManagedClientBoot(runtimeAt(productDir));
    const boot = JSON.parse(
      readFileSync(path.join(plugins, "web", "boot.json"), "utf8"),
    ) as { entries: { id: string }[] };
    expect(boot.entries.map((e) => e.id)).toEqual(["keep-me"]);
  });
});
