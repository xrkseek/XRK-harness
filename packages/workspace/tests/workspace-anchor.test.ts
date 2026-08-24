import { describe, expect, it } from "vitest";
import { formatWorkspaceRootAnchor } from "../src/workspace-anchor.js";

describe("workspace root anchor", () => {
  it("includes absolute path and clarifies display title", () => {
    const text = formatWorkspaceRootAnchor("E:\\projects\\XRK-AGT", "XRK-AGT");
    expect(text).toContain("E:\\projects\\XRK-AGT");
    expect(text).toContain("Display name: XRK-AGT");
    expect(text).toContain("not a filesystem path");
    expect(text).toContain("Do not search other drives");
  });

  it("omits title line when absent", () => {
    const text = formatWorkspaceRootAnchor("/repo/app");
    expect(text).toContain("/repo/app");
    expect(text).not.toContain("Display name:");
  });
});
