/**
 * Boot manifest wire (DeepSeek-compatible shape).
 * Host injects `window.__DSH_BOOT__` (+ alias `__XRK_BOOT__`).
 * Product chat UI uses captured DSH graph (`vendor/dsh-web-static/boot.json`).
 * This app only seeds Face console boot for `?console=1` / Vite dev.
 */

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
