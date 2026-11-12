import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  assertSafePluginPackageName,
  isPluginPackageFamily,
  isSafePluginPackageName,
  isSamePluginPackage,
  resolveContainedPluginPath,
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

  it("rejects path traversal and CLI-flag shaped package names", () => {
    expect(isSafePluginPackageName("xrkh-better-sidebar")).toBe(true);
    expect(isSafePluginPackageName("@scope/pkg")).toBe(true);
    expect(isSafePluginPackageName("../../Windows/Temp/evil")).toBe(false);
    expect(isSafePluginPackageName("--registry=http://evil")).toBe(false);
    expect(isSafePluginPackageName("@scope/a/b")).toBe(false);
    expect(isSafePluginPackageName("has space")).toBe(false);
    expect(() => assertSafePluginPackageName("../evil")).toThrow(/invalid/);
  });

  it("keeps resolveContainedPluginPath under root", () => {
    const root = path.resolve("/tmp/xrk-plugins-fixture");
    expect(resolveContainedPluginPath(root, "web", "plugins", "foo")).toBe(
      path.resolve(root, "web", "plugins", "foo"),
    );
    expect(() =>
      resolveContainedPluginPath(root, "..", "..", "outside"),
    ).toThrow(/escapes/);
  });
});
