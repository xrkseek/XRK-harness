/**
 * Desktop product-entry ladder (ADR-0008). Do not skip a phase.
 * Default product entry stays CLI / Web. The installer is not this phase.
 */
export const DESKTOP_DEFAULT_PRODUCT_ENTRY = "cli-web" as const;

export const DESKTOP_PRODUCT_PHASES = [
  "not-done",
  "development-projection",
  "first-wave-package",
] as const;

export type DesktopProductPhase = (typeof DESKTOP_PRODUCT_PHASES)[number];

export interface DesktopProductEntry {
  /** What `xrkh` / docs tell people to run. Never the Electron installer. */
  readonly defaultEntry: typeof DESKTOP_DEFAULT_PRODUCT_ENTRY;
  /** Current Desktop phase. Installer (`first-wave-package`) is later. */
  readonly phase: "development-projection";
  readonly desktopCommand: "dev:desktop";
  readonly installerShipped: false;
  readonly productReady: false;
}

export function resolveDesktopProductEntry(): DesktopProductEntry {
  return {
    defaultEntry: DESKTOP_DEFAULT_PRODUCT_ENTRY,
    phase: "development-projection",
    desktopCommand: "dev:desktop",
    installerShipped: false,
    productReady: false,
  };
}

/** Packaging must not replace the CLI/Web entry or claim a shipped installer. */
export function assertDesktopInstallerNotDefaultEntry(): DesktopProductEntry {
  const entry = resolveDesktopProductEntry();
  if (entry.defaultEntry !== "cli-web" || entry.productReady || entry.installerShipped) {
    throw new Error(
      "xrk desktop: refusing to skip ADR-0008; installer is not the product entry",
    );
  }
  if (entry.phase !== "development-projection") {
    throw new Error(
      `xrk desktop: phase ${entry.phase} is not the current step (development-projection)`,
    );
  }
  return entry;
}
