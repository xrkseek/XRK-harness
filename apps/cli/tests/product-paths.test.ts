import { existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  bundledProductWebDist,
  defaultProductWebDist,
  isMonorepoCheckout,
  resolveProductWebDist,
} from "../src/product-paths.js";

describe("product-paths", () => {
  it("detects monorepo checkout beside apps/web", () => {
    expect(isMonorepoCheckout()).toBe(true);
    expect(existsSync(path.join(defaultProductWebDist(), "..", "package.json"))).toBe(
      true,
    );
  });

  it("prefers assembled apps/web/dist over packaged product-web", async () => {
    const assembled = path.join(defaultProductWebDist(), "index.html");
    if (!existsSync(assembled)) {
      return;
    }
    const resolved = await resolveProductWebDist();
    expect(resolved).toBe(defaultProductWebDist());
    expect(resolved).not.toBe(bundledProductWebDist());
  });
});
