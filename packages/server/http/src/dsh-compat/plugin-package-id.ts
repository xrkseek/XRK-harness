/**
 * Community plugin package identity helpers.
 *
 * DSH clients register `__ModuleLoader__.load({ id })` with the **loader entry
 * name** (usually the bare package name). npm republishes under `@scope/name`
 * keep that bare registration while install / boot graph rows use the full
 * scoped name. These helpers treat bare and `@scope/bare` as one plugin family
 * so Host adapters and install staging do not hard-code publishers.
 *
 * Also owns install-path / `npm view` argv hygiene (`isSafePluginPackageName`) —
 * single source for CLI · Face · dsh-compat (no peer copies).
 */

import path from "node:path";

/** npm name length cap (registry + filesystem). */
const MAX_PACKAGE_NAME_LEN = 214;

/**
 * One scoped or bare npm package name.
 * Scoped: `@scope/name` with exactly one `/`.
 * Rejects path segments, whitespace, and CLI-flag shapes (`-foo`).
 */
const SAFE_NPM_PACKAGE_NAME =
  /^(?:@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/i;

/** True when `name` is safe to join under pluginsDir / pass as npm argv. */
export function isSafePluginPackageName(name: string): boolean {
  const n = name.trim();
  if (!n || n.length > MAX_PACKAGE_NAME_LEN) return false;
  // Fast reject before regex: traversal, flags, absolute, whitespace.
  if (
    n.includes("..") ||
    n.includes("\\") ||
    n.includes("\0") ||
    n.startsWith("-") ||
    n.startsWith(".") ||
    n.startsWith("/") ||
    /\s/.test(n)
  ) {
    return false;
  }
  if (n.startsWith("@")) {
    const slash = n.indexOf("/");
    // Exactly one slash; both sides non-empty (slash at 0 impossible after @).
    if (slash < 2 || n.indexOf("/", slash + 1) !== -1) return false;
  } else if (n.includes("/")) {
    return false;
  }
  return SAFE_NPM_PACKAGE_NAME.test(n);
}

/** Throw when `name` is unsafe for staging under pluginsDir. */
export function assertSafePluginPackageName(name: string): string {
  const n = name.trim();
  if (!isSafePluginPackageName(n)) {
    throw new Error(`invalid plugin package name: ${JSON.stringify(name)}`);
  }
  return n;
}

/**
 * `path.resolve(root, …segments)` that refuses to leave `root`.
 * Call after {@link assertSafePluginPackageName} (or with fixed safe segments).
 */
export function resolveContainedPluginPath(
  root: string,
  ...segments: string[]
): string {
  const base = path.resolve(root);
  const joined = path.resolve(base, ...segments);
  if (joined !== base && !joined.startsWith(base + path.sep)) {
    throw new Error(
      `plugin path escapes pluginsDir: ${JSON.stringify(segments.join("/"))}`,
    );
  }
  return joined;
}

/** `@scope/pkg` → `pkg`; bare names pass through. */
export function unscopedPackageName(packageName: string): string {
  const name = packageName.trim();
  if (!name.startsWith("@")) return name;
  const slash = name.lastIndexOf("/");
  return slash > 0 ? name.slice(slash + 1) : name;
}

/**
 * True when two install / ModuleLoader ids name the same plugin family
 * (exact match, or same unscoped name across scopes).
 */
export function isSamePluginPackage(a: string, b: string): boolean {
  const left = a.trim();
  const right = b.trim();
  if (!left || !right) return false;
  if (left === right) return true;
  return unscopedPackageName(left) === unscopedPackageName(right);
}

/**
 * True when `packageName` is the bare family id or any scoped republish of it
 * (`dsh-foo` or `@anyone/dsh-foo`).
 */
export function isPluginPackageFamily(
  packageName: string,
  bareFamily: string,
): boolean {
  const bare = bareFamily.trim();
  if (!bare || bare.includes("/")) return false;
  const name = packageName.trim();
  return name === bare || name.endsWith(`/${bare}`);
}
