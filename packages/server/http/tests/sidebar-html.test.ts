import { describe, expect, it } from "vitest";
import { decodeSidebarHtmlPath } from "../src/sidebar/sidebar-html.js";

describe("decodeSidebarHtmlPath", () => {
  it("decodes Windows drive paths", () => {
    const r = decodeSidebarHtmlPath(
      "/sidebar/html/sess1/C%3A/Users/me/proj/www/index.html",
    );
    expect(r?.sessionId).toBe("sess1");
    expect(r?.absPath.replace(/\\/g, "/")).toMatch(
      /C:\/Users\/me\/proj\/www\/index\.html$/i,
    );
  });

  it("decodes POSIX absolute paths", () => {
    const r = decodeSidebarHtmlPath(
      "/sidebar/html/s2/home/me/proj/index.html",
    );
    expect(r).toEqual({
      sessionId: "s2",
      absPath: "/home/me/proj/index.html",
    });
  });

  it("rejects incomplete routes", () => {
    expect(decodeSidebarHtmlPath("/sidebar/html/")).toBeUndefined();
    expect(decodeSidebarHtmlPath("/sidebar/html/only-session")).toBeUndefined();
  });
});
