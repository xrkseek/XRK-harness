/**
 * Detect Host release drift after reconnect (G16).
 *
 * Static shell JS can stay loaded while a new Host process comes up with a
 * different package version. Compare successive `host.describe` versions and
 * optionally the shell's own boot-time release stamp.
 */

export type ReleaseMismatchKind = "host-upgraded" | "shell-stale";

export type ReleaseMismatch = {
  readonly kind: ReleaseMismatchKind;
  readonly shellVersion: string | undefined;
  readonly previousHostVersion: string | undefined;
  readonly hostVersion: string;
};

export type ReleaseMismatchTracker = {
  /** Returns a mismatch when the page should prompt for reload; else undefined. */
  noteHostVersion(hostVersion: string): ReleaseMismatch | undefined;
  readonly lastHostVersion: string | undefined;
};

/**
 * Read an optional shell release stamped at HTML inject time
 * (`window.__XRK_SHELL_VERSION__`). Absent in plain Vite / tests.
 */
export function readShellReleaseVersion(
  globalObject: typeof globalThis = globalThis,
): string | undefined {
  const g = globalObject as { __XRK_SHELL_VERSION__?: unknown };
  const raw = g.__XRK_SHELL_VERSION__;
  if (typeof raw !== "string") return undefined;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function createReleaseMismatchTracker(options?: {
  readonly shellVersion?: string;
}): ReleaseMismatchTracker {
  const shellVersion = options?.shellVersion?.trim() || undefined;
  let lastHostVersion: string | undefined;

  return {
    get lastHostVersion() {
      return lastHostVersion;
    },
    noteHostVersion(hostVersion: string) {
      const next = hostVersion.trim();
      if (!next) return undefined;

      if (
        shellVersion !== undefined &&
        lastHostVersion === undefined &&
        next !== shellVersion
      ) {
        lastHostVersion = next;
        return {
          kind: "shell-stale" as const,
          shellVersion,
          previousHostVersion: undefined,
          hostVersion: next,
        };
      }

      if (lastHostVersion !== undefined && lastHostVersion !== next) {
        const previousHostVersion = lastHostVersion;
        lastHostVersion = next;
        return {
          kind: "host-upgraded" as const,
          shellVersion,
          previousHostVersion,
          hostVersion: next,
        };
      }

      lastHostVersion = next;
      return undefined;
    },
  };
}
