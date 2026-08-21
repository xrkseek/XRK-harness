import type { SessionEvent } from "@xrkseek/protocol";
import {
  estimateSystemTokens,
  estimateToolsTokens,
  foldSurfaceTokens,
} from "@xrkseek/core-session";
import type { ProjectionDefinition } from "../registry.js";
import { asNonNegInt } from "../parse-int.js";

/** Heuristic context composition (DSH contextBreakdown; ContextMeter rows). */
export interface ContextBreakdownProjection {
  readonly systemTokens: number;
  readonly toolsTokens: number;
  readonly messageTokens: number;
}

interface ContextBreakdownState {
  readonly systemTokens: number;
  readonly toolsTokens: number;
  readonly messageTokens: number;
}

/**
 * DSH contextBreakdown over XRK events:
 * envelope last-wins on `request/header.system|tools`;
 * messageTokens rides the same {@link foldSurfaceTokens} as contextPressure
 * (`context/compaction` with `shadowedTokenCount` → signed delta; legacy → 0).
 */
export function createContextBreakdownProjectionUnit(): ProjectionDefinition<
  "contextBreakdown",
  ContextBreakdownState,
  ContextBreakdownProjection
> {
  return {
    key: "contextBreakdown",
    stateVersion: 2,
    init: () => ({ systemTokens: 0, toolsTokens: 0, messageTokens: 0 }),
    apply(state, event: SessionEvent): ContextBreakdownState {
      let systemTokens = state.systemTokens;
      let toolsTokens = state.toolsTokens;
      let messageTokens = state.messageTokens;

      if (event.type === "request/header") {
        systemTokens = estimateSystemTokens(event.header.system);
        toolsTokens = estimateToolsTokens(event.header.tools);
      }

      messageTokens = foldSurfaceTokens(messageTokens, event);

      if (
        systemTokens === state.systemTokens &&
        toolsTokens === state.toolsTokens &&
        messageTokens === state.messageTokens
      ) {
        return state;
      }
      return { systemTokens, toolsTokens, messageTokens };
    },
    wire: {
      view: (state) => state,
      parse(value: unknown): ContextBreakdownProjection {
        if (!value || typeof value !== "object") {
          throw new Error("contextBreakdown projection must be an object");
        }
        const v = value as Record<string, unknown>;
        return {
          systemTokens: asNonNegInt(
            v.systemTokens,
            "contextBreakdown",
            "systemTokens",
          ),
          toolsTokens: asNonNegInt(
            v.toolsTokens,
            "contextBreakdown",
            "toolsTokens",
          ),
          messageTokens: asNonNegInt(
            v.messageTokens,
            "contextBreakdown",
            "messageTokens",
          ),
        };
      },
    },
  };
}
