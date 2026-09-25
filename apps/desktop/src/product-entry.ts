/**
 * Desktop product-entry ladder (ADR-0008).
 * Default product entry stays CLI / Web. First-wave packaging pipeline is open;
 * public installer feed / notarized ship remain gated by credentials + upload (phase 2).
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
  /** Current Desktop phase: first-wave packaging pipeline is open. */
  readonly phase: "first-wave-package";
  /** Primary Desktop maintainer command for this phase. */
  readonly desktopCommand: "package:desktop";
  /** Development projection remains available. */
  readonly developmentCommand: "dev:desktop";
  /**
   * Packaging pipeline ready (electron-builder config · signing hooks · update feed).
   * Does not claim a public feed has been published.
   */
  readonly packagingPipelineReady: true;
  /** Public installer channel / notarized artifacts not yet the shipped product. */
  readonly installerShipped: false;
  /** Product capability gate for Desktop: packaging pipeline exists (≠ default entry). */
  readonly productReady: true;
}

export function resolveDesktopProductEntry(): DesktopProductEntry {
  return {
    defaultEntry: DESKTOP_DEFAULT_PRODUCT_ENTRY,
    phase: "first-wave-package",
    desktopCommand: "package:desktop",
    developmentCommand: "dev:desktop",
    packagingPipelineReady: true,
    installerShipped: false,
    productReady: true,
  };
}

/**
 * Packaging must never replace CLI/Web as the documented default entry.
 * Installer may be produced; it is not what `xrkh` advertises as day-1 entry.
 */
export function assertDesktopInstallerNotDefaultEntry(): DesktopProductEntry {
  const entry = resolveDesktopProductEntry();
  if (entry.defaultEntry !== "cli-web") {
    throw new Error(
      "xrk desktop: refusing skip — installer must not become the default product entry",
    );
  }
  if (entry.installerShipped) {
    throw new Error(
      "xrk desktop: installerShipped flipped without a public feed decision",
    );
  }
  if (entry.phase !== "first-wave-package" || !entry.packagingPipelineReady) {
    throw new Error(
      `xrk desktop: expected first-wave packaging pipeline (got phase=${entry.phase})`,
    );
  }
  return entry;
}
