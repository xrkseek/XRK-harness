/**
 * DeepSeek-compatible boot inject for SPA index.html.
 * Browser globals: `window.__DSH_BOOT__` + alias `__XRK_BOOT__`.
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

/** Default product AppShell roster (local factories in apps/web). */
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
  const idx = lower.lastIndexOf("</head>");
  if (idx >= 0) {
    return html.slice(0, idx) + script + html.slice(idx);
  }
  return script + html;
}
