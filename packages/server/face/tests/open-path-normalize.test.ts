import { describe, expect, it } from "vitest";
import {
  isAbsoluteUrl,
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

describe("isAbsoluteUrl", () => {
  it("recognizes http(s) and custom schemes without treating paths as URLs", () => {
    expect(isAbsoluteUrl("https://example.com/a")).toBe(true);
    expect(isAbsoluteUrl("http://127.0.0.1:3080/sidebar/html/s/a.html")).toBe(
      true,
    );
    expect(isAbsoluteUrl("vscode://file/x")).toBe(true);
    expect(isAbsoluteUrl("C:\\Users\\x\\a.txt")).toBe(false);
    expect(isAbsoluteUrl("/home/u/a.txt")).toBe(false);
  });
});
