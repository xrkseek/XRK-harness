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

describe("desktop workspace membership", () => {
  it("pnpm-workspace apps/* covers desktop and desktop-host", () => {
    const raw = readFileSync(path.join(ROOT, "pnpm-workspace.yaml"), "utf8");
    expect(raw).toMatch(/["']apps\/\*["']/);
    expect(raw).toMatch(/desktop/);
  });

  it("both private packages declare engines.node >=26", () => {
    for (const rel of ["apps/desktop", "apps/desktop-host"]) {
      const pkg = JSON.parse(
        readFileSync(path.join(ROOT, rel, "package.json"), "utf8"),
      ) as { engines?: { node?: string } };
      expect(pkg.engines?.node).toBe(">=26");
    }
  });

  it("pnpm check LINT_PATHS includes desktop sources", () => {
    const check = readFileSync(path.join(ROOT, "scripts", "check.mjs"), "utf8");
    expect(check).toContain('"apps/desktop/src"');
    expect(check).toContain('"apps/desktop-host/src"');
    expect(check).toMatch(/major < 26/);
  });
});
