/**
 * Browser peer of `dsh-compat/plugin-package-id`: scoped npm install names vs
 * bare `__ModuleLoader__.load({ id })` registrations from DSH community clients.
 * Keep the rules identical — Host / CLI import the Node copy; the loader uses this.
 */

/** `@scope/pkg` → `pkg`; bare names pass through. */
export function unscopedPackageName(packageName: string): string {
  const name = packageName.trim()
  if (!name.startsWith('@')) return name
  const slash = name.lastIndexOf('/')
  return slash > 0 ? name.slice(slash + 1) : name
}

/**
 * True when two ModuleLoader / boot-graph ids name the same plugin family.
 */
export function isSamePluginPackage(a: string, b: string): boolean {
  const left = a.trim()
  const right = b.trim()
  if (!left || !right) return false
  if (left === right) return true
  return unscopedPackageName(left) === unscopedPackageName(right)
}
