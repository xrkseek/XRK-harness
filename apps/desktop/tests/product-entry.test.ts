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
  it("keeps CLI/Web as default while opening first-wave packaging pipeline", () => {
    const entry = assertDesktopInstallerNotDefaultEntry();
    expect(entry).toEqual(resolveDesktopProductEntry());
    expect(entry.defaultEntry).toBe("cli-web");
    expect(entry.phase).toBe("first-wave-package");
    expect(entry.desktopCommand).toBe("package:desktop");
    expect(entry.developmentCommand).toBe("dev:desktop");
    expect(entry.packagingPipelineReady).toBe(true);
    expect(entry.installerShipped).toBe(true);
    expect(entry.productReady).toBe(true);
    expect(isDesktopProductReady()).toBe(true);
  });

  it("package:desktop validates the pipeline without inventing a public installer as day-1 entry", () => {
    const result = spawnSync(
      process.execPath,
      [path.join(ROOT, "scripts", "package-desktop.mjs"), "--check"],
      { encoding: "utf8", env: { ...process.env } },
    );
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/packaging pipeline ready/);
    expect(result.stdout).toMatch(/packagingPipelineReady=true/);
    expect(result.stdout).toMatch(/defaultEntry=cli-web/);
    expect(result.stdout).toMatch(/installerShipped=true/);
    expect(result.stdout).toMatch(/upload:desktop/);
  });
});
