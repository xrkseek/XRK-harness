import {
  inputPressureTokens,
  usageFromSessionEvent,
  type SessionEvent,
} from "@xrkseek/protocol";
import { foldSurfaceTokens } from "@xrkseek/core-session";
import type { ProjectionDefinition } from "../registry.js";
import { asOptNonNegInt, asOptPositiveInt } from "../parse-int.js";

/**
 * Approximate context occupancy (DSH contextPressure; ContextMeter).
 * Provider pressure from {@link inputPressureTokens} (prefer `totalTokens` /
 * Codex `tokens_in_context_window`, else `input + cacheRead`; never cacheWrite);
 * capacity from `request/header.config.contextWindow`;
 * projectedTokens = pressure + (surface − sampledSurface) after stamp-before-append
 * (same formula as core-session {@link projectedInputPressureTokens}).
 *
 * Compaction must **not** drop `pressureTokens`: surface fold already shrinks
 * via `shadowedTokenCount`. Wiping the sample made soft-budget blind to the
 * provider until the next usage event (DSH keeps the sample across replace).
 */
export interface ContextPressureProjection {
  readonly pressureTokens?: number;
  readonly projectedTokens?: number;
  readonly contextWindow?: number;
}

interface ContextPressureState {
  readonly pressureTokens?: number;
  readonly contextWindow?: number;
  readonly surfaceTokens: number;
  readonly sampledSurfaceTokens?: number;
}

export function createContextPressureProjectionUnit(): ProjectionDefinition<
  "contextPressure",
  ContextPressureState,
  ContextPressureProjection
> {
  return {
    key: "contextPressure",
    // v5: keep provider pressure across compaction (DSH); surface delta shrinks projected.
    stateVersion: 5,
    init: () => ({ surfaceTokens: 0 }),
    apply(state, event: SessionEvent): ContextPressureState {
      let next: ContextPressureState = state;

      if (event.type === "request/header") {
        const window = event.header.config.contextWindow;
        if (window !== state.contextWindow) {
          next =
            window === undefined
              ? (() => {
                  const { contextWindow: _drop, ...rest } = next;
                  return rest;
                })()
              : { ...next, contextWindow: window };
        }
      }

      // Stamp usage against surface BEFORE this event joins (DSH order).
      const usage = usageFromSessionEvent(event);
      if (usage !== undefined) {
        const pressureTokens = inputPressureTokens(usage);
        if (
          pressureTokens !== next.pressureTokens ||
          next.sampledSurfaceTokens !== next.surfaceTokens
        ) {
          next = {
            ...next,
            pressureTokens,
            sampledSurfaceTokens: next.surfaceTokens,
          };
        }
      }

      const surfaceTokens = foldSurfaceTokens(next.surfaceTokens, event);
      if (surfaceTokens !== next.surfaceTokens) {
        next = { ...next, surfaceTokens };
      }

      return next;
    },
    wire: {
      view: (state) => {
        const out: {
          -readonly [K in keyof ContextPressureProjection]?: ContextPressureProjection[K];
        } = {};
        if (state.contextWindow !== undefined) {
          out.contextWindow = state.contextWindow;
        }
        if (state.pressureTokens !== undefined) {
          out.pressureTokens = state.pressureTokens;
          const sampled = state.sampledSurfaceTokens ?? state.surfaceTokens;
          out.projectedTokens = Math.max(
            0,
            state.pressureTokens + state.surfaceTokens - sampled,
          );
        }
        return out;
      },
      parse(value: unknown): ContextPressureProjection {
        if (!value || typeof value !== "object") {
          throw new Error("contextPressure projection must be an object");
        }
        const v = value as Record<string, unknown>;
        const pressureTokens = asOptNonNegInt(
          v.pressureTokens,
          "contextPressure",
          "pressureTokens",
        );
        const projectedTokens = asOptNonNegInt(
          v.projectedTokens,
          "contextPressure",
          "projectedTokens",
        );
        const contextWindow = asOptPositiveInt(
          v.contextWindow,
          "contextPressure",
          "contextWindow",
        );
        return {
          ...(pressureTokens !== undefined ? { pressureTokens } : {}),
          ...(projectedTokens !== undefined ? { projectedTokens } : {}),
          ...(contextWindow !== undefined ? { contextWindow } : {}),
        };
      },
    },
  };
}
