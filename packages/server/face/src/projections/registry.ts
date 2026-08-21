/**
 * Face projection types + thin wrapper over `@xrkseek/session-projection`.
 * Units live here; the seam owns drive / dual maps / optional wire.
 */

import type { ImageAttachmentLimits } from "@xrkseek/attachment";
import type { PlanProjection, TodoItem } from "@xrkseek/protocol";
import {
  createSessionProjectionRegistry,
  type SessionProjectionRegistry,
  type SessionProjectionRegistryOptions,
} from "@xrkseek/session-projection";
import type { PermissionSelect } from "../permissions.js";

export type {
  ProjectionChangeListener,
  ProjectionCheckpoint,
  ProjectionCheckpointRow,
  ProjectionDefinition,
  ProjectionSnapshot,
  ProjectionWire,
} from "@xrkseek/session-projection";

/** Well-known projection keys owned by Face default units (client views). */
export interface FaceProjectionMap {
  /** Latest title, or null while untitled. */
  readonly title: string | null;
  /** Sidebar list hint. */
  readonly sessionListMetadata: SessionListMetadata;
  /** Standing plan (DSH TodoDock); null before write / after turn/start. */
  readonly todos: TodoItem[] | null;
  /** Permission select (DSH Access chip); folded from knob events. */
  readonly permissions: PermissionSelect;
  /** Plan-mode chip: logged active + pending `/plan` selection. */
  readonly plan: PlanProjection;
  /**
   * Attachment intake limits (DSH InputBar pre-check). Present only while
   * Face has an AttachmentStore; constant per boot — no change frames.
   */
  readonly imageLimits: ImageAttachmentLimits;
  /**
   * Whole-log turn/step counts and wall times (DSH sessionStats).
   * StatsLine reads this so paging cannot change the strip.
   */
  readonly sessionStats: {
    readonly turns: number;
    readonly steps: number;
    readonly llmMs: number;
    readonly toolMs: number;
    readonly ttftMs: number;
    readonly ttftSteps: number;
    readonly decodeMs: number;
    readonly decodeTokens: number;
  };
  /** Cumulative provider token buckets (DSH tokenUsage; StatsLine). */
  readonly tokenUsage: {
    readonly uncachedInputTokens: number;
    readonly outputTokens: number;
    readonly cacheReadTokens: number;
    readonly cacheWriteTokens: number;
  };
  /** Newest prompt pressure + route capacity (DSH contextPressure; ContextMeter). */
  readonly contextPressure: {
    readonly pressureTokens?: number;
    readonly projectedTokens?: number;
    readonly contextWindow?: number;
  };
  /** Heuristic system/tools/message composition (DSH contextBreakdown). */
  readonly contextBreakdown: {
    readonly systemTokens: number;
    readonly toolsTokens: number;
    readonly messageTokens: number;
  };
}

export interface SessionListMetadata {
  readonly blank: boolean;
  readonly lastPromptAt: number | null;
}

declare module "@xrkseek/session-projection" {
  // Face default unit keys (empty body is intentional merge).
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type -- declaration merge
  interface SessionProjectionMap extends FaceProjectionMap {}
}

export type FaceProjectionRegistryOptions = SessionProjectionRegistryOptions;

/** Face carrier registry (same contract as the seam). */
export type FaceProjectionRegistry = SessionProjectionRegistry;

export function createFaceProjectionRegistry(
  options: FaceProjectionRegistryOptions,
): FaceProjectionRegistry {
  return createSessionProjectionRegistry(options);
}
