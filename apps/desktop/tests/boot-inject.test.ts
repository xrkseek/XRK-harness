import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  injectDesktopBootIntoHtml,
  loadDesktopBootManifest,
  maybeInjectDesktopBootHtml,
} from "../src/boot-inject.js";

describe("desktop boot inject", () => {
  it("injects __XRK_BOOT__ before </head>", () => {
    const html = "<html><head><title>t</title></head><body></body></html>";
    const out = injectDesktopBootIntoHtml(html, {
      rev: "r1",
      entries: [{ id: "@xrkseek/client-runtime", url: "/plugins/x/client.js", rev: "a" }],
    });
    expect(out).toContain("window.__XRK_BOOT__=");
    expect(out.indexOf("__XRK_BOOT__")).toBeLessThan(out.indexOf("</head>"));
    expect(out).toContain('"rev":"r1"');
  });

  it("loads boot.json and injects only for index.html", () => {
    const root = mkdtempSync(join(tmpdir(), "xrk-desktop-boot-"));
    writeFileSync(
      join(root, "boot.json"),
      JSON.stringify({ rev: "cap", entries: [] }),
      "utf8",
    );
    const indexPath = join(root, "index.html");
    const raw = Buffer.from("<html><head></head><body></body></html>", "utf8");
    const injected = maybeInjectDesktopBootHtml(root, indexPath, raw);
    expect(injected.toString("utf8")).toContain('"rev":"cap"');
    expect(
      maybeInjectDesktopBootHtml(
        root,
        join(root, "other.html"),
        raw,
      ).equals(raw),
    ).toBe(true);
    expect(loadDesktopBootManifest(root)?.rev).toBe("cap");
  });
});
