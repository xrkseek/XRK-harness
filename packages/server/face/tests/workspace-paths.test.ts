import { describe, expect, it } from "vitest";
import {
  defaultWorkspaceTitle,
  outsideWorkspaceJobNotice,
} from "../src/workspace-paths.js";
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

describe("outsideWorkspaceJobNotice", () => {
  it("warns when the prompt names absolute paths outside the workspace root", () => {
    const note = outsideWorkspaceJobNotice(
      "C:\\Users\\xrkseek\\Desktop\\主仓库\\XRK-harness",
      "工作目录：C:\\Users\\xrkseek\\Desktop\\function\\hwgen — 写画像",
    );
    expect(note).toBeTruthy();
    expect(note).toContain("Desktop\\function\\hwgen");
    expect(note).toContain("IM only");
    expect(note).toContain("inherits this session workspace");
  });

  it("stays quiet when paths stay inside the workspace", () => {
    expect(
      outsideWorkspaceJobNotice(
        "C:\\Users\\xrkseek\\Desktop\\主仓库\\XRK-harness",
        "edit C:\\Users\\xrkseek\\Desktop\\主仓库\\XRK-harness\\packages\\core\\agent-loop\\src\\index.ts",
      ),
    ).toBeUndefined();
    expect(
      outsideWorkspaceJobNotice(
        "/Users/me/proj",
        "relative path only: packages/foo",
      ),
    ).toBeUndefined();
  });
});
