/**
 * Empty `contextHeaders` so dsh-context browser does not treat headers as
 * permanently unavailable (null is ok for UI, but empty list is clearer).
 */
import type { SessionEvent } from "@xrkseek/protocol";
import type { ProjectionDefinition } from "../registry.js";

export interface ContextHeadersProjection {
  readonly headers: readonly {
    readonly system?: string;
    readonly tools: readonly unknown[];
  }[];
}

export function createContextHeadersProjectionUnit(): ProjectionDefinition<
  "contextHeaders",
  ContextHeadersProjection,
  ContextHeadersProjection
> {
  return {
    key: "contextHeaders",
    stateVersion: 1,
    init: () => ({ headers: [] }),
    apply(state, _event: SessionEvent): ContextHeadersProjection {
      return state;
    },
    wire: {
      view: (state) => state,
      parse(value: unknown): ContextHeadersProjection {
        if (!value || typeof value !== "object") {
          throw new Error("contextHeaders projection must be an object");
        }
        const v = value as Record<string, unknown>;
        if (!Array.isArray(v.headers)) {
          throw new Error("contextHeaders.headers must be an array");
        }
        return { headers: v.headers as ContextHeadersProjection["headers"] };
      },
    },
  };
}
