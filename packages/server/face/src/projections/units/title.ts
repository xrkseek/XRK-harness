import type { SessionEvent } from "@xrkseek/protocol";
import type { ProjectionDefinition } from "../registry.js";

export interface TitleProjectionState {
  readonly title: string | null;
  /** User rename pins — automatic fallback must not overwrite. */
  readonly pinned: boolean;
}

export function createTitleProjectionUnit(): ProjectionDefinition<
  "title",
  TitleProjectionState,
  string | null
> {
  return {
    key: "title",
    stateVersion: 1,
    init: () => ({ title: null, pinned: false }),
    apply(state, event: SessionEvent): TitleProjectionState {
      if (event.type !== "session/title") return state;
      if (event.source.kind === "user") {
        return { title: event.title, pinned: true };
      }
      if (state.pinned) return state;
      if (state.title === event.title) return state;
      return { title: event.title, pinned: false };
    },
    wire: {
      view: (state) => state.title,
      parse(value: unknown): string | null {
        if (value === null) return null;
        if (typeof value === "string") return value;
        throw new Error("title projection must be string | null");
      },
    },
  };
}
