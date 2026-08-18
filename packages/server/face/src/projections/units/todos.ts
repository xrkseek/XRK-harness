import type { SessionEvent, TodoItem } from "@xrkseek/protocol";
import type { ProjectionDefinition } from "../registry.js";

/**
 * DSH standing-plan `todos` projection:
 * latest `todo/write` list; cleared on next `turn/start`; null before first write.
 */
export function createTodosProjectionUnit(): ProjectionDefinition<
  "todos",
  TodoItem[] | null,
  TodoItem[] | null
> {
  return {
    key: "todos",
    stateVersion: 2,
    init: () => null,
    apply(state, event: SessionEvent): TodoItem[] | null {
      if (event.type === "todo/write") return [...event.todos];
      if (event.type === "turn/start") return null;
      return state;
    },
    view: (state) => state,
    parse(value: unknown): TodoItem[] | null {
      if (value === null) return null;
      if (!Array.isArray(value)) {
        throw new Error("todos projection must be TodoItem[] | null");
      }
      const out: TodoItem[] = [];
      for (const row of value) {
        if (!row || typeof row !== "object") {
          throw new Error("todos projection item invalid");
        }
        const content = (row as { content?: unknown }).content;
        const status = (row as { status?: unknown }).status;
        if (typeof content !== "string") {
          throw new Error("todos.content must be string");
        }
        if (
          status !== "pending" &&
          status !== "in_progress" &&
          status !== "completed"
        ) {
          throw new Error("todos.status invalid");
        }
        out.push({ content, status });
      }
      return out;
    },
  };
}
