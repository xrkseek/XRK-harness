import { describe, expect, it } from "vitest";
import {
  normalizeOpenPath,
  windowsExplorerPath,
} from "../src/host-open-path.js";

describe("normalizeOpenPath", () => {
  it("strips trailing slash-dot from client joins", () => {
    expect(normalizeOpenPath("C:\\proj\\.")).toBe("C:\\proj");
    expect(normalizeOpenPath("/proj/.")).toBe("/proj");
    expect(normalizeOpenPath("/proj/")).toBe("/proj");
    expect(normalizeOpenPath("/proj/./.")).toBe("/proj");
  });

  it("keeps POSIX and Windows drive roots qualified", () => {
    expect(normalizeOpenPath("/.")).toBe("/");
    expect(normalizeOpenPath("/")).toBe("/");
    expect(normalizeOpenPath("C:\\.")).toBe("C:\\");
    expect(normalizeOpenPath("C:/.")).toBe("C:/");
    expect(normalizeOpenPath("C:\\")).toBe("C:\\");
  });
});

describe("windowsExplorerPath", () => {
  it("forces backslashes so Explorer /select does not eat path segments", () => {
    expect(windowsExplorerPath("C:/Users/x/proj/file.txt")).toBe(
      "C:\\Users\\x\\proj\\file.txt",
    );
    expect(windowsExplorerPath("C:\\Users\\x\\proj\\.")).toBe(
      "C:\\Users\\x\\proj",
    );
    expect(windowsExplorerPath("C:/.")).toBe("C:\\");
  });
});
