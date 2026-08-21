import type { SessionEvent } from "@xrkseek/protocol";
import type {
  ProjectionDefinition,
  SessionListMetadata,
} from "../registry.js";

export function createSessionListMetadataUnit(): ProjectionDefinition<
  "sessionListMetadata",
  SessionListMetadata,
  SessionListMetadata
> {
  return {
    key: "sessionListMetadata",
    stateVersion: 1,
    init: () => ({ blank: true, lastPromptAt: null }),
    apply(state, event: SessionEvent): SessionListMetadata {
      const blank = state.blank && event.type !== "turn/start";
      const lastPromptAt =
        event.type === "user/message" ? event.ts : state.lastPromptAt;
      if (blank === state.blank && lastPromptAt === state.lastPromptAt) {
        return state;
      }
      return { blank, lastPromptAt };
    },
    wire: {
      view: (state) => state,
      parse(value: unknown): SessionListMetadata {
        if (value === null || typeof value !== "object") {
          throw new Error("sessionListMetadata must be an object");
        }
        const v = value as { blank?: unknown; lastPromptAt?: unknown };
        if (typeof v.blank !== "boolean") {
          throw new Error("sessionListMetadata.blank must be boolean");
        }
        if (
          !(v.lastPromptAt === null || typeof v.lastPromptAt === "number")
        ) {
          throw new Error("sessionListMetadata.lastPromptAt must be number|null");
        }
        return { blank: v.blank, lastPromptAt: v.lastPromptAt };
      },
    },
  };
}
