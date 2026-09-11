import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = path.dirname(fileURLToPath(import.meta.url));

describe("slash menu locale refresh wiring", () => {
  it("InputTriggerService refreshes open menus on locale/change", () => {
    const src = readFileSync(
      path.join(root, "../src/client/service.ts"),
      "utf8",
    );
    expect(src).toContain("locale/change");
    expect(src).toContain("refreshOpenMenu");
  });

  it("InputTriggerController.refreshOpenMenu keeps the current hit", () => {
    const src = readFileSync(
      path.join(root, "../src/client/controller.ts"),
      "utf8",
    );
    expect(src).toMatch(/refreshOpenMenu\(\):\s*void/);
    expect(src).toContain("this.fetchCandidates(this.hit, roster)");
  });
});
