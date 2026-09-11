import { describe, expect, it } from "vitest";
import { defaultWorkspaceTitle } from "../src/workspace-paths.js";
import { fullyQualified } from "../src/host-directory.js";

describe("workspace path title + create absolute check", () => {
  it("defaultWorkspaceTitle keeps drive-root spelling", () => {
    expect(defaultWorkspaceTitle("C:\\", "win32")).toBe("C:\\");
    expect(defaultWorkspaceTitle("C:\\work", "win32")).toBe("work");
    expect(defaultWorkspaceTitle("\\\\server\\share", "win32")).toBe("share");
    expect(defaultWorkspaceTitle("/", "linux")).toBe("/");
    expect(defaultWorkspaceTitle("/work", "darwin")).toBe("work");
  });

  it("fullyQualified accepts drive roots / UNC; rejects bare drive and current-drive relatives", () => {
    expect(fullyQualified("C:\\", "win32")).toBe(true);
    expect(fullyQualified("C:\\work", "win32")).toBe(true);
    expect(fullyQualified("\\\\server\\share", "win32")).toBe(true);
    expect(fullyQualified("C:", "win32")).toBe(false);
    expect(fullyQualified("C:work", "win32")).toBe(false);
    expect(fullyQualified("\\work", "win32")).toBe(false);
    expect(fullyQualified(".", "win32")).toBe(false);
    expect(fullyQualified("/work", "linux")).toBe(true);
    expect(fullyQualified("work", "linux")).toBe(false);
  });
});
