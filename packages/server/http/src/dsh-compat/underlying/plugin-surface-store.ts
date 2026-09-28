/**
 * Per-community-plugin surface docs under ~/.xrk/community-surfaces/<id>/.
 * Shared by generic `/_dsh/<pkg>/…` and community-root `…/api/{config,state}`.
 */
import { createXrkDocStore, type XrkDocStore } from "./doc-store.js";

export interface PluginSurfaceDoc {
  config: Record<string, unknown>;
  state: Record<string, unknown>;
  settings: Record<string, unknown>;
  revision: number;
}

const EMPTY: PluginSurfaceDoc = {
  config: {},
  state: {},
  settings: {},
  revision: 0,
};

const stores = new Map<string, XrkDocStore<PluginSurfaceDoc>>();

/** Sanitize a package/slug id for use as a path segment. */
export function sanitizePluginSurfaceId(pluginId: string): string {
  const cleaned = pluginId
    .trim()
    .replace(/[^a-zA-Z0-9._@+-]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
  return (cleaned || "unknown").slice(0, 96);
}

export function pluginSurfaceStore(
  pluginId: string,
): XrkDocStore<PluginSurfaceDoc> {
  const id = sanitizePluginSurfaceId(pluginId);
  let store = stores.get(id);
  if (!store) {
    store = createXrkDocStore<PluginSurfaceDoc>(
      ["community-surfaces", id, "surface.json"],
      EMPTY,
    );
    stores.set(id, store);
  }
  return store;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

export function readPluginSurface(
  xrkHome: string | undefined,
  pluginId: string,
): PluginSurfaceDoc {
  const doc = pluginSurfaceStore(pluginId).read(xrkHome).data;
  return {
    config: asRecord(doc.config),
    state: asRecord(doc.state),
    settings: asRecord(doc.settings),
    revision: typeof doc.revision === "number" ? doc.revision : 0,
  };
}

export type PluginSurfaceBucket = "config" | "state" | "settings";

export function patchPluginSurface(
  xrkHome: string | undefined,
  pluginId: string,
  bucket: PluginSurfaceBucket,
  patch: Record<string, unknown>,
  mode: "merge" | "replace" = "merge",
): PluginSurfaceDoc {
  const doc = pluginSurfaceStore(pluginId).patch(xrkHome, (current) => {
    const prev = asRecord(current[bucket]);
    const next =
      mode === "replace" ? { ...patch } : { ...prev, ...patch };
    return {
      config: asRecord(current.config),
      state: asRecord(current.state),
      settings: asRecord(current.settings),
      [bucket]: next,
      revision: (typeof current.revision === "number" ? current.revision : 0) + 1,
    };
  });
  return {
    config: asRecord(doc.data.config),
    state: asRecord(doc.data.state),
    settings: asRecord(doc.data.settings),
    revision: doc.data.revision,
  };
}
