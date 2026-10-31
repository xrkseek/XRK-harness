/**
 * CLI peer of `dsh-compat/plugin-package-id` (keep rules identical).
 * Kept local so vitest / source runs do not need `@xrkseek/server-http` dist.
 */

/** `@scope/pkg` → `pkg`; bare names pass through. */
export function unscopedPackageName(packageName: string): string {
  const name = packageName.trim();
  if (!name.startsWith("@")) return name;
  const slash = name.lastIndexOf("/");
  return slash > 0 ? name.slice(slash + 1) : name;
}

/** True when two install / ModuleLoader ids name the same plugin family. */
export function isSamePluginPackage(a: string, b: string): boolean {
  const left = a.trim();
  const right = b.trim();
  if (!left || !right) return false;
  if (left === right) return true;
  return unscopedPackageName(left) === unscopedPackageName(right);
}

/**
 * True when `packageName` is the bare family id or any scoped republish
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
