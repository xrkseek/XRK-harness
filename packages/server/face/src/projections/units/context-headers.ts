/**
 * DSH `contextHeaders` for community `dsh-context` browser.
 * Last-wins header epochs from `request/header` (system + standing tools).
 * Item counts for system/tools come from the live header, not from tokens alone.
 */
import type { SessionEvent } from "@xrkseek/protocol";
import { estimateToolsTokens } from "@xrkseek/core-session";
import type { ProjectionDefinition } from "../registry.js";

/** One tool row as dsh-context `ToolSchema` expects. */
export interface ContextHeaderTool {
  readonly name: string;
  readonly description: string;
  /** JSON Schema / parameters object (DSH field name `schema`). */
  readonly schema: Record<string, unknown>;
  readonly tokens: number;
}

export interface ContextHeaderEntry {
  /** Event seq when this header was logged (1-based drive seq). */
  readonly seq: number;
  readonly system?: string;
  readonly tools: readonly ContextHeaderTool[];
}

export interface ContextHeadersProjection {
  readonly headers: readonly ContextHeaderEntry[];
}

interface ContextHeadersState {
  /** Events applied so far (= last drive seq). */
  readonly applied: number;
  readonly headers: readonly ContextHeaderEntry[];
}

function toolRows(
  tools:
    | readonly {
        readonly name: string;
        readonly description: string;
        readonly parameters: Record<string, unknown>;
      }[]
    | undefined,
): ContextHeaderTool[] {
  if (!tools?.length) return [];
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    schema: tool.parameters,
    tokens: estimateToolsTokens([tool]),
  }));
}

export function createContextHeadersProjectionUnit(): ProjectionDefinition<
  "contextHeaders",
  ContextHeadersState,
  ContextHeadersProjection
> {
  return {
    key: "contextHeaders",
    stateVersion: 2,
    init: () => ({ applied: 0, headers: [] }),
    apply(state, event: SessionEvent): ContextHeadersState {
      const seq = state.applied + 1;
      if (event.type !== "request/header") {
        return { ...state, applied: seq };
      }

      const system = event.header.system;
      const entry: ContextHeaderEntry = {
        seq,
        ...(typeof system === "string" && system.length > 0
          ? { system }
          : {}),
        tools: toolRows(event.header.tools),
      };
      return {
        applied: seq,
        headers: [...state.headers, entry],
      };
    },
    wire: {
      view: (state) => ({ headers: state.headers }),
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
