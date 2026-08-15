/** Branded string ids used across the kernel. */

export type PluginId = string & { readonly __brand: "PluginId" };

export function pluginId(id: string): PluginId {
  if (!id.trim()) {
    throw new Error("plugin id must be a non-empty string");
  }
  return id as PluginId;
}

export type ServiceKey = string | symbol;
