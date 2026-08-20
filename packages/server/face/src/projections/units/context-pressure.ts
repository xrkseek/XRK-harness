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
 * Provider pressure from usage; capacity from `request/header.config.contextWindow`;
 * projectedTokens = pressure + (surface − sampledSurface) after stamp-before-append.
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
    stateVersion: 3,
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
  };
}
