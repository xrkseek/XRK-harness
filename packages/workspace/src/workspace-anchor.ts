/**
 * Durable inject anchor: absolute workspace root + runtime surface for the model
 * (title is display-only). The surface line is what lets the model tell a browser
 * tab from the Electron desktop shell or a terminal.
 */

/** Shell surface that hosts the agent runtime — how the human is looking at it. */
export type RuntimeSurface = "desktop" | "web" | "tui" | "acp" | "cli";

/** Env var each entry point sets so the model can tell web from desktop. */
export const RUNTIME_SURFACE_ENV = "XRK_SURFACE" as const;

const SURFACE_DESCRIPTIONS: Record<RuntimeSurface, string> = {
  desktop:
    "the **Electron desktop app** — native file/folder pickers and `host.openPath` are available, there is no browser tab, and the Host is reached over framed pipes instead of loopback HTTP",
  web:
    "a **browser tab** against the Host HTTP surface (`xrkh web` / `serve`) — OS file dialogs are not guaranteed, so prefer Host `sidebar` / `openPath` over shell-level `start` / `open`",
  tui:
    "the **terminal UI** attached to a running Host (`xrkh tui`) — the human reads a text console, not a rendered page",
  acp:
    "an **ACP** (agent-client-protocol) session driven by an external editor or client",
  cli:
    "a **headless CLI run** (`xrkh run`) — there is no interactive shell surface",
};

/**
 * Normalize a raw `XRK_SURFACE` value, tolerating common synonyms.
 * @param raw - raw env string (untrimmed, any case).
 * @returns the surface, or undefined when unset / unknown.
 */
export function normalizeRuntimeSurface(
  raw: string | undefined,
): RuntimeSurface | undefined {
  const value = raw?.trim().toLowerCase();
  if (!value) return undefined;
  if (
    value === "desktop" ||
    value === "web" ||
    value === "tui" ||
    value === "acp" ||
    value === "cli"
  ) {
    return value;
  }
  if (value === "electron" || value === "app" || value === "native") {
    return "desktop";
  }
  if (value === "serve" || value === "http" || value === "browser") return "web";
  if (value === "terminal" || value === "console") return "tui";
  return undefined;
}

/**
 * Resolve the surface from an env bag.
 * @param env - environment bag (defaults to `process.env`).
 * @returns the surface, or undefined when the entry point declared none.
 */
export function resolveRuntimeSurface(
  env: Record<string, string | undefined> = process.env,
): RuntimeSurface | undefined {
  return normalizeRuntimeSurface(env[RUNTIME_SURFACE_ENV]);
}

/**
 * Model-facing runtime-surface paragraph.
 * @param surface - resolved surface, or undefined to emit nothing.
 * @returns markdown block, or "" when unknown.
 */
export function formatRuntimeSurfaceAnchor(
  surface: RuntimeSurface | undefined,
): string {
  if (surface === undefined) return "";
  return [
    "## Runtime surface",
    `The human is looking at ${SURFACE_DESCRIPTIONS[surface]}.`,
    "Do not claim capabilities of another surface (desktop vs browser vs terminal).",
  ].join("\n");
}

/**
 * Durable inject anchor: absolute workspace root (+ optional runtime surface).
 * @param root - workspace root path.
 * @param displayTitle - sidebar label (display-only).
 * @param surface - runtime surface; appends the `## Runtime surface` paragraph.
 */
export function formatWorkspaceRootAnchor(
  root: string,
  displayTitle?: string,
  surface?: RuntimeSurface,
): string {
  const path = root.trim();
  if (!path) return "";
  const title = displayTitle?.trim();
  const lines = [
    "## Workspace root",
    `\`${path}\``,
    ...(title ? [`Display name: ${title} (sidebar label — not a filesystem path).`] : []),
    "All relative tool paths resolve here. Shell tools default their cwd to this root — `pwd` / `Get-Location` must show this path, not the Host process directory.",
    "Do not search other drives for the project.",
  ];
  const surfaceBlock = formatRuntimeSurfaceAnchor(surface);
  if (surfaceBlock) lines.push("", surfaceBlock);
  return lines.join("\n");
}
