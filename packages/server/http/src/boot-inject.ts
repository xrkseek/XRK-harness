/**
 * Boot inject for product SPA index.html.
 * Browser globals: `window.__XRK_BOOT__` (+ compatibility `__DSH_BOOT__`).
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

/** Fallback when no captured DSH boot.json — Face console / legacy tests only. */
export const XRK_APP_SHELL_BOOT: WebBootManifest = {
  rev: "xrk-app-shell",
  entries: [
    {
      id: "@xrkseek/connection",
      url: "/local/connection",
      rev: "local",
      inject: [],
      immediately: true,
    },
    {
      id: "@xrkseek/face-client",
      url: "/local/face-client",
      rev: "local",
      inject: [],
      immediately: true,
    },
    {
      id: "@xrkseek/layout-slots",
      url: "/local/layout-slots",
      rev: "local",
      inject: [],
      immediately: true,
    },
  ],
};

/** Opt-in Face console verifier graph. */
export const FACE_CONSOLE_BOOT: WebBootManifest = {
  rev: "xrk-face-console",
  entries: [
    {
      id: "@xrkseek/face-console",
      url: "/plugins/face-console.js",
      rev: "local",
      inject: [],
      immediately: true,
    },
  ],
};

/**
 * Load captured boot graph from `boot.json` next to a web dist root
 * (produced by `scripts/capture-web-static.mjs`).
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

/** Prefer captured DSH `boot.json`; else legacy console fallback roster. */
export function resolveWebBootManifest(webDistRoot?: string): WebBootManifest {
  if (webDistRoot) {
    const captured = loadBootManifestFromWebDist(webDistRoot);
    if (captured) return captured;
  }
  return XRK_APP_SHELL_BOOT;
}

export function bootInjectScript(manifest: WebBootManifest): string {
  const json = JSON.stringify(manifest);
  return `<script>window.__DSH_BOOT__=${json};window.__XRK_BOOT__=window.__DSH_BOOT__;</script>`;
}

/** Insert boot script before `</head>` (or prepend). */
export function injectBootIntoHtml(
  html: string,
  manifest: WebBootManifest,
): string {
  const script = bootInjectScript(manifest);
  const lower = html.toLowerCase();
  // Strip any prior inject so capture+serve does not double-inject.
  const stripped = html.replace(
    /<script>\s*window\.__DSH_BOOT__[\s\S]*?<\/script>/i,
    "",
  );
  const idx = stripped.toLowerCase().lastIndexOf("</head>");
  if (idx >= 0) {
    return stripped.slice(0, idx) + script + stripped.slice(idx);
  }
  return script + stripped;
}
