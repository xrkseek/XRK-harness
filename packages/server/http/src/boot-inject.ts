/**
 * Boot inject for product SPA index.html.
 * Browser global: `window.__XRK_BOOT__`.
 */

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

export interface WebBootEntry {
  readonly id: string;
  readonly url: string;
  readonly rev: string;
  readonly inject: readonly string[];
  readonly immediately?: boolean;
}

export interface WebBootManifest {
  readonly rev: string;
  readonly entries: readonly WebBootEntry[];
}

const EMPTY_BOOT: WebBootManifest = { rev: "none", entries: [] };

/**
 * Load captured boot graph from `boot.json` next to a web dist root.
 */
export function loadBootManifestFromWebDist(
  webDistRoot: string,
): WebBootManifest | undefined {
  const bootPath = path.join(path.resolve(webDistRoot), "boot.json");
  if (!existsSync(bootPath)) return undefined;
  try {
    const raw = JSON.parse(readFileSync(bootPath, "utf8")) as unknown;
    if (!raw || typeof raw !== "object") return undefined;
    const o = raw as Record<string, unknown>;
    if (typeof o.rev !== "string" || !Array.isArray(o.entries)) return undefined;
    return raw as WebBootManifest;
  } catch {
    return undefined;
  }
}

/** Historical Cordis UI / runner ids (no longer in-tree) plus HMR. */
export const XRK_OMIT_CLIENT_PLUGIN_IDS = [
  "@xrkseek/client-ui-cordis",
  "@xrkseek/xrk-cordis-client-runner",
  "@xrkseek/client-hmr",
] as const;

/** Drop product-omitted ids. Overlay cannot put them back. */
export function applyXrkProductBootPolicy(
  manifest: WebBootManifest,
): WebBootManifest {
  const omit = new Set<string>(XRK_OMIT_CLIENT_PLUGIN_IDS);
  const entries = manifest.entries.filter((e) => !omit.has(e.id));
  if (entries.length === manifest.entries.length) return manifest;
  return { rev: manifest.rev, entries };
}

/** Product `boot.json` under webDist; otherwise empty (no console substitute). */
export function resolveWebBootManifest(webDistRoot?: string): WebBootManifest {
  if (webDistRoot) {
    const captured = loadBootManifestFromWebDist(webDistRoot);
    if (captured) return captured;
  }
  return EMPTY_BOOT;
}

/**
 * Merge extra boot entries onto a base graph. Extra `id` replaces base.
 * Used for `{pluginsDir}/web/boot.json` overlay.
 */
export function mergeWebBootManifests(
  base: WebBootManifest,
  extra?: WebBootManifest,
): WebBootManifest {
  if (!extra) return base;
  const byId = new Map(base.entries.map((e) => [e.id, e]));
  for (const entry of extra.entries) {
    byId.set(entry.id, entry);
  }
  return {
    rev: extra.rev ? `${base.rev}+${extra.rev}` : base.rev,
    entries: [...byId.values()],
  };
}

export function bootInjectScript(manifest: WebBootManifest): string {
  const json = JSON.stringify(manifest);
  return `<script>window.__XRK_BOOT__=${json};</script>`;
}

/** Insert boot script before `</head>` (or prepend). */
export function injectBootIntoHtml(
  html: string,
  manifest: WebBootManifest,
): string {
  const script = bootInjectScript(manifest);
  const stripped = html.replace(
    /<script>\s*window\.__XRK_BOOT__[\s\S]*?<\/script>/i,
    "",
  );
  const idx = stripped.toLowerCase().lastIndexOf("</head>");
  if (idx >= 0) {
    return stripped.slice(0, idx) + script + stripped.slice(idx);
  }
  return script + stripped;
}
