import { describe, expect, it } from "vitest";
import {
  isPluginPackageFamily,
  isSamePluginPackage,
  unscopedPackageName,
} from "../src/dsh-compat/plugin-package-id.js";

describe("plugin-package-id", () => {
  it("unscope npm names", () => {
    expect(unscopedPackageName("dsh-foo")).toBe("dsh-foo");
    expect(unscopedPackageName("@scope/dsh-foo")).toBe("dsh-foo");
    expect(unscopedPackageName("  @a/b  ")).toBe("b");
  });

  it("treats bare and scoped republish as the same package family", () => {
    expect(isSamePluginPackage("dsh-foo", "dsh-foo")).toBe(true);
    expect(isSamePluginPackage("dsh-foo", "@pub/dsh-foo")).toBe(true);
    expect(isSamePluginPackage("@a/dsh-foo", "@b/dsh-foo")).toBe(true);
    expect(isSamePluginPackage("dsh-foo", "dsh-bar")).toBe(false);
    expect(isSamePluginPackage("dsh-foo", "@pub/dsh-bar")).toBe(false);
  });

  it("matches host adapter families by bare id under any scope", () => {
    expect(isPluginPackageFamily("dsh-our-free-model", "dsh-our-free-model")).toBe(
      true,
    );
    expect(
      isPluginPackageFamily("@pub/dsh-our-free-model", "dsh-our-free-model"),
    ).toBe(true);
    expect(isPluginPackageFamily("dsh-other", "dsh-our-free-model")).toBe(false);
    expect(isPluginPackageFamily("@pub/dsh-our-free-model", "dsh/our")).toBe(
      false,
    );
  });
});
