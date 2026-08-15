import type { FaceProjectionRegistry } from "./registry.js";
import { createTitleProjectionUnit } from "./units/title.js";
import { createSessionListMetadataUnit } from "./units/session-list-metadata.js";

/** Register Face default projection units (title + list metadata). */
export function installDefaultFaceProjections(
  registry: FaceProjectionRegistry,
): { dispose(): void } {
  const offTitle = registry.register(createTitleProjectionUnit());
  const offMeta = registry.register(createSessionListMetadataUnit());
  return {
    dispose() {
      offTitle();
      offMeta();
    },
  };
}
