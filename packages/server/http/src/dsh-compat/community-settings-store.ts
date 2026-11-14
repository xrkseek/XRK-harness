/**
 * Face-backed settings store for community Cordis `installSection`.
 * Shared by nekowhale / wallpaper / peers — one shape, durable yaml.
 */
import type { DshCompatWireOptions } from "./adapter-types.js";
import type { CommunitySettingsStore } from "./community-cordis-surfaces.js";

/** Wire Face `ensureCommunitySettingsNamespace` into the Cordis settings bridge. */
export function faceSettingsStoreFromWire(
  wire: DshCompatWireOptions,
): CommunitySettingsStore | undefined {
  const ensure = wire.ensureCommunitySettingsNamespace;
  if (typeof ensure !== "function") return undefined;
  return {
    ensure(namespace, defaults) {
      return ensure(namespace, defaults ?? {});
    },
  };
}
