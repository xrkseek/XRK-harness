/**
 * Shared child-env scrub (CV from DSH `dsh-subprocess` scrubbedParentEnv /
 * subprocess-local `childEnv`). Ambient credential-shaped names and harness
 * identity prefixes are dropped; explicit `extra` merges after the scrub.
 */

/** Ambient harness identity — never leak into children unless explicit. */
export const XRK_ENV_PREFIX = "XRK_" as const;

/** Peer harness prefix also stripped from ambient (same hygiene as DSH↔XRK). */
export const DSH_ENV_PREFIX = "DSH_" as const;

/**
 * One heuristic for every in-repo spawner; a deliberately supplied entry
 * survives because explicit env layers merge after the scrub.
 */
export const SENSITIVE_ENV_PATTERN = /KEY|PASSWORD|SECRET|TOKEN/i;

/**
 * Ambient parent env minus credential-shaped names and minus `XRK_*` / `DSH_*`.
 * `PATH`, `HOME`, locale, and proxy variables survive.
 */
export function scrubbedParentEnv(
  source: NodeJS.ProcessEnv = process.env,
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(source)) {
    if (value === undefined) continue;
    if (SENSITIVE_ENV_PATTERN.test(key)) continue;
    const upper = key.toUpperCase();
    if (upper.startsWith(XRK_ENV_PREFIX) || upper.startsWith(DSH_ENV_PREFIX)) {
      continue;
    }
    // Dynamic linker injection (process-hardening subset portable in userland).
    if (
      upper.startsWith("LD_") ||
      upper.startsWith("DYLD_")
    ) {
      continue;
    }
    env[key] = value;
  }
  return env;
}

/**
 * Build a child environment: explicit caller entries override the scrubbed
 * parent base. On Windows, keys merge case-insensitively; an explicit
 * `undefined` tombstone removes an ambient entry.
 */
export function childEnv(
  extra?: Readonly<NodeJS.ProcessEnv>,
  source: NodeJS.ProcessEnv = process.env,
): Record<string, string> {
  const env: Record<string, string> = { ...scrubbedParentEnv(source) };
  const extraEntries = Object.entries(extra ?? {});
  if (process.platform !== "win32") {
    for (const [key, value] of extraEntries) {
      if (value === undefined) delete env[key];
      else env[key] = value;
    }
    return env;
  }
  let entries = Object.entries(env);
  for (const [key, value] of extraEntries) {
    const normalized = key.toUpperCase();
    entries = entries.filter(
      ([inherited]) => inherited.toUpperCase() !== normalized,
    );
    if (value !== undefined) entries.push([key, value]);
  }
  return Object.fromEntries(entries);
}
