import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  injectDesktopBootIntoHtml,
  loadDesktopBootManifest,
  maybeInjectDesktopBootHtml,
  mergeDesktopBootManifests,
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
  });

  it("merges community overlay entries onto product boot", () => {
    const product = mkdtempSync(join(tmpdir(), "xrk-desktop-boot-prod-"));
    const overlay = mkdtempSync(join(tmpdir(), "xrk-desktop-boot-ov-"));
    writeFileSync(
      join(product, "boot.json"),
      JSON.stringify({
        rev: "prod",
        entries: [
          {
            id: "@xrkseek/client-runtime",
            url: "/plugins/@xrkseek/client-runtime/client.js",
            rev: "1",
          },
        ],
      }),
      "utf8",
    );
    writeFileSync(
      join(overlay, "boot.json"),
      JSON.stringify({
        rev: "ov",
        entries: [
          {
            id: "dsh-niulai-pet",
            url: "/plugins/dsh-niulai-pet/client.js",
            rev: "0.4.13",
          },
        ],
      }),
      "utf8",
    );
    const merged = mergeDesktopBootManifests(
      loadDesktopBootManifest(product)!,
      loadDesktopBootManifest(overlay),
    );
    expect(merged.rev).toBe("prod+ov");
    expect(merged.entries.map((e) => e.id)).toEqual([
      "@xrkseek/client-runtime",
      "dsh-niulai-pet",
    ]);

    const raw = Buffer.from("<html><head></head><body></body></html>", "utf8");
    const html = maybeInjectDesktopBootHtml(
      product,
      join(product, "index.html"),
      raw,
      { overlayRoot: overlay },
    ).toString("utf8");
    expect(html).toContain("dsh-niulai-pet");
    expect(html).toContain("@xrkseek/client-runtime");
  });
});
