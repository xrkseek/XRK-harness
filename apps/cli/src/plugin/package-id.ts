/**
 * Plugin package identity — re-export the single source in
 * `@xrkseek/server-http` (dsh-compat/plugin-package-id).
 * Keep this module as the CLI import surface so call sites stay stable.
 */
export {
  isSafePluginPackageName,
  assertSafePluginPackageName,
  resolveContainedPluginPath,
  unscopedPackageName,
  isSamePluginPackage,
  isPluginPackageFamily,
} from "@xrkseek/server-http";
