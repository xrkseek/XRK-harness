import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  assertDesktopInstallerNotDefaultEntry,
  resolveDesktopProductEntry,
} from "../src/product-entry.js";
import { isDesktopProductReady } from "../src/desktop-bootstrap.js";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
);

describe("desktop product entry (ADR-0008)", () => {
  it("keeps CLI/Web as the default and does not ship the installer", () => {
    const entry = assertDesktopInstallerNotDefaultEntry();
    expect(entry).toEqual(resolveDesktopProductEntry());
    expect(entry.defaultEntry).toBe("cli-web");
    expect(entry.phase).toBe("development-projection");
    expect(entry.desktopCommand).toBe("dev:desktop");
    expect(entry.installerShipped).toBe(false);
    expect(isDesktopProductReady()).toBe(false);
  });

  it("package:desktop refuses to skip to an installer", () => {
    const result = spawnSync(
      process.execPath,
      [path.join(ROOT, "scripts", "package-desktop.mjs")],
      { encoding: "utf8" },
    );
    expect(result.status).toBe(2);
    expect(result.stderr).toMatch(
      /refusing to skip ADR-0008|not a first-wave packaging host/,
    );
  });
});
