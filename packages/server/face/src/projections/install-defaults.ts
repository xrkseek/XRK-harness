import type { ImageAttachmentLimits } from "@xrkseek/attachment";
import type { FaceProjectionRegistry } from "./registry.js";
import { createTitleProjectionUnit } from "./units/title.js";
import { createSessionListMetadataUnit } from "./units/session-list-metadata.js";
import { createTodosProjectionUnit } from "./units/todos.js";
import { createPermissionsProjectionUnit } from "./units/permissions.js";
import { createPlanProjectionUnit } from "./units/plan.js";
import { createImageLimitsProjectionUnit } from "./units/image-limits.js";
import { createSessionStatsProjectionUnit } from "./units/session-stats.js";
import { createTokenUsageProjectionUnit } from "./units/token-usage.js";
import { createContextPressureProjectionUnit } from "./units/context-pressure.js";
import { createContextBreakdownProjectionUnit } from "./units/context-breakdown.js";
import { createContextTimelineProjectionUnit } from "./units/context-timeline.js";
import { createContextHeadersProjectionUnit } from "./units/context-headers.js";
import { createAutoReviewProjectionUnit } from "./units/auto-review.js";
import { createCostUsageProjectionUnit } from "./units/cost-usage.js";

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
  const offTokenUsage = registry.register(createTokenUsageProjectionUnit());
  const offPressure = registry.register(createContextPressureProjectionUnit());
  const offBreakdown = registry.register(createContextBreakdownProjectionUnit());
  const offTimeline = registry.register(createContextTimelineProjectionUnit());
  const offHeaders = registry.register(createContextHeadersProjectionUnit());
  const offAutoReview = registry.register(createAutoReviewProjectionUnit());
  const offCostUsage = registry.register(createCostUsageProjectionUnit());
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
      offTokenUsage();
      offPressure();
      offBreakdown();
      offTimeline();
      offHeaders();
      offAutoReview();
      offCostUsage();
      offLimits?.();
    },
  };
}
