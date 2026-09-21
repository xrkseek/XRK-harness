/**
 * Shared filesystem path helpers for XRK-Harness product data (`~/.xrk`).
 * Mirrors DSH `@deepseek-ai/dsh-home-paths` posture so leaf packages and
 * server-config share one resolution (env precedence + `~/` expand).
 *
 * @module @xrkseek/xrk-home-paths
 */
import { homedir } from "node:os";
import path from "node:path";

/** Directory name under the OS home. */
export const XRK_HOME_DIR_NAME = ".xrk";

/** Stable user-facing display form for the default product home. */
export const DEFAULT_XRK_HOME_DISPLAY = `~/${XRK_HOME_DIR_NAME}`;

/** Env vars that override the default home (first non-empty wins). */
export const XRK_HOME_ENVS = ["XRK_HOME", "XRK_DSH_HOME", "DSH_HOME"] as const;

/** Default `~/.xrk`. */
export function defaultXrkHome(): string {
  return path.join(homedir(), XRK_HOME_DIR_NAME);
}

/**
 * Expand supported tilde prefixes against the OS home.
 * Returns the original value when no supported prefix is present.
 */
export function expandHomePath(value: string): string {
  if (value === "~") return homedir();
  if (value.startsWith("~/") || value.startsWith("~\\")) {
    return path.join(homedir(), value.slice(2));
  }
  return value;
}

/**
 * Resolve the single-root product home from env.
 * Precedence: `XRK_HOME` → `XRK_DSH_HOME` → `DSH_HOME` → `~/.xrk`.
 * Empty / whitespace-only env is treated as unset.
 */
export function resolveXrkHome(
  env: NodeJS.ProcessEnv = process.env,
): string {
  for (const key of XRK_HOME_ENVS) {
    const raw = env[key]?.trim();
    if (raw) return path.resolve(expandHomePath(raw));
  }
  return path.resolve(defaultXrkHome());
}

/**
 * Like {@link resolveXrkHome}, but an explicit configured path wins over env.
 * Used by Host/Face injectors that pass `xrkHome` / `productDir`.
 */
export function resolveConfiguredXrkHome(
  configured: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const explicit = configured?.trim();
  if (explicit) return path.resolve(expandHomePath(explicit));
  return resolveXrkHome(env);
}

/** Join segments onto the resolved product home. */
export function xrkHomePath(
  ...segments: string[]
): string {
  return path.join(resolveXrkHome(), ...segments);
}

/**
 * Join path segments onto the product home's `cache` directory without creating it.
 * Rebuildable data (request-image variants, etc.) belongs here — not under durable
 * `{home}/attachments/v1`.
 *
 * @param optionsOrSegment - explicit home override, or the first path segment.
 * @param segments - additional path segments after the first child, if any.
 */
export function xrkCachePath(
  optionsOrSegment: { readonly xrkHome?: string } | string = {},
  ...segments: string[]
): string {
  if (typeof optionsOrSegment === "string") {
    return xrkHomePath("cache", optionsOrSegment, ...segments);
  }
  return path.join(
    resolveConfiguredXrkHome(optionsOrSegment.xrkHome),
    "cache",
    ...segments,
  );
}

/**
 * Describe a resolved home for user-facing copy.
 * Default home → `~/.xrk`; otherwise `$XRK_HOME` (primary override name).
 */
export function xrkHomeDisplay(resolvedHome: string): string {
  return resolvedHome === path.resolve(defaultXrkHome())
    ? DEFAULT_XRK_HOME_DISPLAY
    : `$${XRK_HOME_ENVS[0]}`;
}

export {
  SPILL_MAX_AGE_MS,
  SPILL_MAX_FILE_BYTES,
  SPILL_MAX_TOTAL_BYTES,
  capSpillText,
  pruneSpillTree,
  type PruneSpillTreeOptions,
} from "./spill-budget.js";
