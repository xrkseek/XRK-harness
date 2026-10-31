/**
 * Community plugin package identity helpers.
 *
 * DSH clients register `__ModuleLoader__.load({ id })` with the **loader entry
 * name** (usually the bare package name). npm republishes under `@scope/name`
 * keep that bare registration while install / boot graph rows use the full
 * scoped name. These helpers treat bare and `@scope/bare` as one plugin family
 * so Host adapters and install staging do not hard-code publishers.
 */

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
