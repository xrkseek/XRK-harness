import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
);

describe("desktop root scripts", () => {
  it("exposes build:desktop / dev:desktop / start:desktop on the workspace root", () => {
    const pkg = JSON.parse(
      readFileSync(path.join(ROOT, "package.json"), "utf8"),
    ) as { scripts?: Record<string, string> };
    expect(pkg.scripts?.["build:desktop"]).toBe(
      "node ./scripts/build-desktop.mjs",
    );
    expect(pkg.scripts?.["dev:desktop"]).toBe("node ./scripts/dev-desktop.mjs");
    expect(pkg.scripts?.["start:desktop"]).toBe(
      "node ./scripts/dev-desktop.mjs --skip-build",
    );
  });

  it("desktop package wires filter-friendly dev / start / prepare scripts", () => {
    const pkg = JSON.parse(
      readFileSync(path.join(ROOT, "apps", "desktop", "package.json"), "utf8"),
    ) as { scripts?: Record<string, string>; devDependencies?: Record<string, string> };
    expect(pkg.scripts?.dev).toContain("dev-desktop.mjs");
    expect(pkg.scripts?.start).toContain("--skip-build");
    expect(pkg.scripts?.["prepare:runtime"]).toContain("prepare-runtime.mjs");
    expect(pkg.scripts?.["prepare:package-set"]).toContain(
      "prepare-package-set.mjs",
    );
    expect(pkg.devDependencies?.pnpm).toBe("11.22.0");
  });
});
