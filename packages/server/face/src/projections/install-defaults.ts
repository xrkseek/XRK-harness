import type { ImageAttachmentLimits } from "@xrkseek/attachment";
import type { FaceProjectionRegistry } from "./registry.js";
import { createTitleProjectionUnit } from "./units/title.js";
import { createSessionListMetadataUnit } from "./units/session-list-metadata.js";
import { createTodosProjectionUnit } from "./units/todos.js";
import { createPermissionsProjectionUnit } from "./units/permissions.js";
import { createPlanProjectionUnit } from "./units/plan.js";
import { createImageLimitsProjectionUnit } from "./units/image-limits.js";
import { createSessionStatsProjectionUnit } from "./units/session-stats.js";

export interface InstallDefaultFaceProjectionsOptions {
  /**
   * When set, register DSH `imageLimits` (boot-constant). Omit when no
   * AttachmentStore — shell treats missing key as no upload surface.
   */
  readonly imageLimits?: ImageAttachmentLimits;
}

/** Register Face default projection units. */
export function installDefaultFaceProjections(
  registry: FaceProjectionRegistry,
  options: InstallDefaultFaceProjectionsOptions = {},
): { dispose(): void } {
  const offTitle = registry.register(createTitleProjectionUnit());
  const offMeta = registry.register(createSessionListMetadataUnit());
  const offTodos = registry.register(createTodosProjectionUnit());
  const offPerm = registry.register(createPermissionsProjectionUnit());
  const offPlan = registry.register(createPlanProjectionUnit());
  const offStats = registry.register(createSessionStatsProjectionUnit());
  const offLimits =
    options.imageLimits !== undefined
      ? registry.register(createImageLimitsProjectionUnit(options.imageLimits))
      : undefined;
  return {
    dispose() {
      offTitle();
      offMeta();
      offTodos();
      offPerm();
      offPlan();
      offStats();
      offLimits?.();
    },
  };
}
