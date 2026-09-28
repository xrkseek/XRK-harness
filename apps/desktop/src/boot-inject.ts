/**
 * Inject `window.__XRK_BOOT__` into product index.html for static `xrk-app://` serve.
 * Mirrors `@xrkseek/server-http` boot-inject (keep lean; Desktop does not depend on server-http).
 * When Host Fetch is unset, merge `{pluginsDir}/web/boot.json` so community clients still boot.
 */

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

export interface DesktopWebBootEntry {
  readonly id: string;
  readonly url: string;
  readonly rev: string;
  readonly inject?: readonly string[];
  readonly immediately?: boolean;
}

export interface DesktopWebBootManifest {
  readonly rev: string;
  readonly entries: readonly DesktopWebBootEntry[];
}

/** Load assembled `boot.json` under a web root (product dist or plugins overlay). */
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

/**
 * Merge overlay entries onto a base graph (extra `id` replaces base).
 * Same shape as server-http `mergeWebBootManifests`.
 */
export function mergeDesktopBootManifests(
  base: DesktopWebBootManifest,
  extra?: DesktopWebBootManifest,
): DesktopWebBootManifest {
  if (extra === undefined) return base;
  const byId = new Map(base.entries.map((e) => [e.id, e]));
  for (const entry of extra.entries) {
    byId.set(entry.id, entry);
  }
  return {
    rev: extra.rev ? `${base.rev}+${extra.rev}` : base.rev,
    entries: [...byId.values()],
  };
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

export interface MaybeInjectDesktopBootHtmlOptions {
  /** `{pluginsDir}/web` — community `boot.json` overlay (Host-down static path). */
  readonly overlayRoot?: string;
}

/**
 * When serving `index.html` from the product Web root, inject boot.json
 * (product + optional community overlay). Non-HTML or missing boot → body unchanged.
 */
export function maybeInjectDesktopBootHtml(
  webRoot: string,
  filePath: string,
  body: Buffer,
  options: MaybeInjectDesktopBootHtmlOptions = {},
): Buffer {
  if (path.basename(filePath).toLowerCase() !== "index.html") return body;
  const base = loadDesktopBootManifest(webRoot);
  const overlay =
    options.overlayRoot !== undefined
      ? loadDesktopBootManifest(options.overlayRoot)
      : undefined;
  if (base === undefined && overlay === undefined) return body;
  const manifest = mergeDesktopBootManifests(
    base ?? { rev: "empty", entries: [] },
    overlay,
  );
  const html = injectDesktopBootIntoHtml(body.toString("utf8"), manifest);
  return Buffer.from(html, "utf8");
}
