/**
 * Inject `window.__XRK_BOOT__` into product index.html for static `xrk-app://` serve.
 * Mirrors `@xrkseek/server-http` boot-inject (keep lean; Desktop does not depend on server-http).
 */

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

export interface DesktopWebBootManifest {
  readonly rev: string;
  readonly entries: readonly unknown[];
}

/** Load assembled `boot.json` next to the Web dist root. */
export function loadDesktopBootManifest(
  webRoot: string,
): DesktopWebBootManifest | undefined {
  const bootPath = path.join(path.resolve(webRoot), "boot.json");
  if (!existsSync(bootPath)) return undefined;
  try {
    const raw = JSON.parse(readFileSync(bootPath, "utf8")) as unknown;
    if (typeof raw !== "object" || raw === null) return undefined;
    const o = raw as Record<string, unknown>;
    if (typeof o.rev !== "string" || !Array.isArray(o.entries)) return undefined;
    return raw as DesktopWebBootManifest;
  } catch {
    return undefined;
  }
}

/** Insert boot script before `</head>` (or prepend). */
export function injectDesktopBootIntoHtml(
  html: string,
  manifest: DesktopWebBootManifest,
): string {
  const script = `<script>window.__XRK_BOOT__=${JSON.stringify(manifest)};</script>`;
  const stripped = html.replace(
    /<script>\s*window\.__XRK_BOOT__[\s\S]*?<\/script>/iu,
    "",
  );
  const idx = stripped.toLowerCase().lastIndexOf("</head>");
  if (idx >= 0) {
    return stripped.slice(0, idx) + script + stripped.slice(idx);
  }
  return script + stripped;
}

/**
 * When serving `index.html` from the product Web root, inject boot.json.
 * Non-HTML or missing boot → return body unchanged.
 */
export function maybeInjectDesktopBootHtml(
  webRoot: string,
  filePath: string,
  body: Buffer,
): Buffer {
  if (path.basename(filePath).toLowerCase() !== "index.html") return body;
  const manifest = loadDesktopBootManifest(webRoot);
  if (manifest === undefined) return body;
  const html = injectDesktopBootIntoHtml(body.toString("utf8"), manifest);
  return Buffer.from(html, "utf8");
}
