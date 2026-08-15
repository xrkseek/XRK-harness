/**
 * Boot manifest wire (DeepSeek-compatible shape).
 * Host injects as `window.__DSH_BOOT__` (and alias `__XRK_BOOT__`).
 * @see docs/learn/xrk-app-shell.md
 */

import { BOOT_ENTRY_IDS } from "./boot-composition.js";

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

declare global {
  interface Window {
    __DSH_BOOT__?: WebBootManifest;
    __XRK_BOOT__?: WebBootManifest;
  }
}

export { BOOT_ENTRY_IDS } from "./boot-composition.js";

/** Product AppShell graph (host tap + Vite seed). Local factories only. */
export const XRK_APP_SHELL_BOOT: WebBootManifest = {
  rev: "xrk-app-shell",
  entries: BOOT_ENTRY_IDS.map((id) => ({
    id: `@xrkseek/${id}`,
    url: `/local/${id}`,
    rev: "local",
    inject: [],
    immediately: true,
  })),
};

/** Opt-in Face console verifier (`?console=1`). */
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

export function readBootManifest(): WebBootManifest | undefined {
  if (typeof window === "undefined") return undefined;
  return window.__XRK_BOOT__ ?? window.__DSH_BOOT__;
}

/** Script tag body for host index tap. */
export function bootInjectScript(manifest: WebBootManifest): string {
  const json = JSON.stringify(manifest);
  return `<script>window.__DSH_BOOT__=${json};window.__XRK_BOOT__=window.__DSH_BOOT__;</script>`;
}
