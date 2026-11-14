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
import {
  isLibCordisHostIncomplete,
  stageNekowhaleHost,
  stageWallpaperEngineHost,
} from "../src/plugin/stage-community-host.js";

const temps: string[] = [];

afterEach(() => {
  for (const d of temps.splice(0)) {
    try {
      rmSync(d, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
});

describe("stageWallpaperEngineHost", () => {
  it("copies lib + cordis.patch.yml without requiring npm when no deps", () => {
    const root = mkdtempSync(path.join(tmpdir(), "we-stage-src-"));
    const dest = mkdtempSync(path.join(tmpdir(), "we-stage-dst-"));
    temps.push(root, dest);
    mkdirSync(path.join(root, "lib"), { recursive: true });
    writeFileSync(path.join(root, "lib", "index.js"), "export function apply() {}");
    writeFileSync(path.join(root, "cordis.patch.yml"), "- insert: []\n");
    writeFileSync(
      path.join(root, "package.json"),
      JSON.stringify({
        name: "dsh-plugin-wallpaper-engine",
        version: "1.0.0",
        dependencies: {},
      }),
    );

    expect(
      stageWallpaperEngineHost(root, dest, "dsh-plugin-wallpaper-engine"),
    ).toBe(true);
    expect(existsSync(path.join(dest, "lib", "index.js"))).toBe(true);
    expect(existsSync(path.join(dest, "cordis.patch.yml"))).toBe(true);
    expect(isLibCordisHostIncomplete(dest, "dsh-plugin-wallpaper-engine")).toBe(
      false,
    );
  });
});

describe("stageNekowhaleHost", () => {
  it("copies lib / meta / skills / client/ui", () => {
    const root = mkdtempSync(path.join(tmpdir(), "nk-stage-src-"));
    const dest = mkdtempSync(path.join(tmpdir(), "nk-stage-dst-"));
    temps.push(root, dest);
    mkdirSync(path.join(root, "lib"), { recursive: true });
    mkdirSync(path.join(root, "meta"), { recursive: true });
    mkdirSync(path.join(root, "skills", "nekowhale-stickers"), {
      recursive: true,
    });
    mkdirSync(path.join(root, "client", "ui"), { recursive: true });
    writeFileSync(path.join(root, "lib", "index.js"), "export function apply() {}");
    writeFileSync(path.join(root, "meta", "nekowhale.json"), "{}");
    writeFileSync(
      path.join(root, "skills", "nekowhale-stickers", "SKILL.md"),
      "---\nname: nekowhale-stickers\n---\n",
    );
    mkdirSync(path.join(root, "client", "ui", "balance"), { recursive: true });
    writeFileSync(
      path.join(root, "client", "ui", "balance", "panel.png"),
      "png",
    );
    writeFileSync(
      path.join(root, "package.json"),
      JSON.stringify({
        name: "dsh-nekowhale-stickers",
        version: "1.0.0",
        dependencies: {},
      }),
    );

    expect(stageNekowhaleHost(root, dest, "dsh-nekowhale-stickers")).toBe(true);
    expect(existsSync(path.join(dest, "lib", "index.js"))).toBe(true);
    expect(existsSync(path.join(dest, "meta", "nekowhale.json"))).toBe(true);
    expect(
      existsSync(path.join(dest, "skills", "nekowhale-stickers", "SKILL.md")),
    ).toBe(true);
    expect(
      readFileSync(
        path.join(dest, "client", "ui", "balance", "panel.png"),
        "utf8",
      ),
    ).toBe("png");
  });

  it("flags incomplete when client.js present without lib", () => {
    const dest = mkdtempSync(path.join(tmpdir(), "nk-incomplete-"));
    temps.push(dest);
    writeFileSync(path.join(dest, "client.js"), "// client");
    expect(isLibCordisHostIncomplete(dest, "dsh-nekowhale-stickers")).toBe(
      true,
    );
  });
});
