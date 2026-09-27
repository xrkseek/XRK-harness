import { describe, expect, it } from "vitest";
import {
  formatWorkspaceRootAnchor,
  normalizeRuntimeSurface,
  resolveRuntimeSurface,
} from "../src/workspace-anchor.js";

describe("workspace root anchor", () => {
  it("includes absolute path and clarifies display title", () => {
    const text = formatWorkspaceRootAnchor("E:\\projects\\XRK-AGT", "XRK-AGT");
    expect(text).toContain("E:\\projects\\XRK-AGT");
    expect(text).toContain("Display name: XRK-AGT");
    expect(text).toContain("not a filesystem path");
    expect(text).toContain("Do not search other drives");
    expect(text).toMatch(/pwd|Get-Location/);
    expect(text).toContain("Host process");
  });

  it("omits title line when absent", () => {
    const text = formatWorkspaceRootAnchor("/repo/app");
    expect(text).toContain("/repo/app");
    expect(text).not.toContain("Display name:");
  });

  it("appends the runtime surface paragraph (desktop vs web)", () => {
    const desktop = formatWorkspaceRootAnchor("/repo/app", undefined, "desktop");
    expect(desktop).toContain("## Runtime surface");
    expect(desktop).toContain("Electron desktop app");

    const web = formatWorkspaceRootAnchor("/repo/app", undefined, "web");
    expect(web).toContain("## Runtime surface");
    expect(web).toContain("browser tab");
    expect(web).not.toContain("Electron desktop app");
  });

  it("omits the surface paragraph when the surface is unknown", () => {
    expect(formatWorkspaceRootAnchor("/repo/app")).not.toContain("Runtime surface");
  });
});

describe("runtime surface resolution", () => {
  it("normalizes known ids and common synonyms", () => {
    expect(normalizeRuntimeSurface(" Desktop ")).toBe("desktop");
    expect(normalizeRuntimeSurface("electron")).toBe("desktop");
    expect(normalizeRuntimeSurface("serve")).toBe("web");
    expect(normalizeRuntimeSurface("terminal")).toBe("tui");
    expect(normalizeRuntimeSurface("")).toBeUndefined();
    expect(normalizeRuntimeSurface("nope")).toBeUndefined();
  });

  it("resolves from an env bag (undefined when unset)", () => {
    expect(resolveRuntimeSurface({ XRK_SURFACE: "desktop" })).toBe("desktop");
    expect(resolveRuntimeSurface({})).toBeUndefined();
  });
});
