/** Electron single-instance ownership before any Desktop profile lifecycle begins (ADR-0008). */

/**
 * Process-lifetime ownership of the Desktop install graph.
 * Primary owner: Electron `requestSingleInstanceLock` (this module).
 * Defense-in-depth while mutating packages: `desktop/lock` PID journal
 * (`package-lock.ts`) so a live orphan worker is never treated as a stale lock.
 */

/** Minimal Electron application operations needed for instance ownership. */
export interface DesktopSingleInstanceApplication {
  requestSingleInstanceLock(): boolean;
  quit(): void;
  on(event: "second-instance", listener: () => void): unknown;
}

/**
 * Claim the process-lifetime Desktop lock and route later launches to the owner.
 * @returns true only in the process that may access the Desktop profile.
 */
export function claimDesktopSingleInstance(
  application: DesktopSingleInstanceApplication,
  focusOwner: () => void,
): boolean {
  if (!application.requestSingleInstanceLock()) {
    application.quit();
    return false;
  }
  application.on("second-instance", focusOwner);
  return true;
}
