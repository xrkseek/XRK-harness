/**
 * Soft-disable helpers — leaf implementation lives in `@xrkseek/server-loader`
 * so HTTP / Face / Host / CLI share one disk contract without Face↔HTTP cycles.
 */
export {
  DISABLED_PLUGINS_FILE,
  MANAGED_PLUGINS_INVENTORY_FILE,
  canonicalizeDisabledPluginIdsAt,
  clearSoftDisabledIdsAt,
  disabledPluginsPath,
  isPluginSoftDisabledAt,
  lookupManagedPluginSourceAt,
  managedPluginsInventoryPath,
  readDisabledPluginIdsAt,
  readManagedPackageIndexAt,
  readManagedPluginPackagesAt,
  setSoftDisabledAt,
  writeDisabledPluginIdsAt,
  type ManagedPackageIndex,
  type ManagedPluginPackageMeta,
} from "@xrkseek/server-loader";
