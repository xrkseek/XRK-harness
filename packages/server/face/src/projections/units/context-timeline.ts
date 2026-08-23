/**
 * DSH `contextTimeline` for community `dsh-context` tab.
 * XRK has no Cordis Host timeline fold; this unit publishes a minimal
 * valid view so the tab leaves "Reading the session log…" and renders
 * empty charts until a richer fold exists.
 */
import type { SessionEvent } from "@xrkseek/protocol";
import {
  estimateSystemTokens,
  estimateToolsTokens,
  foldSurfaceTokens,
} from "@xrkseek/core-session";
import type { ProjectionDefinition } from "../registry.js";
import { asNonNegInt, asOptPositiveInt } from "../parse-int.js";

/** Wire shape consumed by dsh-context `timelineOf`. */
export interface ContextTimelineProjection {
  readonly current: {
    readonly system: number;
    readonly tools: number;
    readonly user: number;
    readonly inject: number;
    readonly assistant: number;
    readonly tool: number;
    readonly total: number;
  };
  readonly toolList: readonly unknown[];
  readonly requests: readonly unknown[];
  readonly events: readonly unknown[];
  readonly nodes: readonly unknown[];
  readonly archive: readonly unknown[];
  readonly droppedNodes: number;
  readonly model?: string;
  readonly provider?: string;
  readonly contextWindow?: number;
}

interface ContextTimelineState {
  readonly system: number;
  readonly tools: number;
  readonly messages: number;
  readonly model?: string;
  readonly provider?: string;
  readonly contextWindow?: number;
}

function viewOf(state: ContextTimelineState): ContextTimelineProjection {
  const total = Math.max(0, state.system + state.tools + state.messages);
  return {
    current: {
      system: state.system,
      tools: state.tools,
      user: state.messages,
      inject: 0,
      assistant: 0,
      tool: 0,
      total,
    },
    toolList: [],
    requests: [],
    events: [],
    nodes: [],
    archive: [],
    droppedNodes: 0,
    ...(state.model !== undefined ? { model: state.model } : {}),
    ...(state.provider !== undefined ? { provider: state.provider } : {}),
    ...(state.contextWindow !== undefined
      ? { contextWindow: state.contextWindow }
      : {}),
  };
}

/**
 * Publish always-present timeline so dsh-context does not hang on null.
 * Breakdown is heuristic (system/tools from header; messages = surface fold).
 */
export function createContextTimelineProjectionUnit(): ProjectionDefinition<
  "contextTimeline",
  ContextTimelineState,
  ContextTimelineProjection
> {
  return {
    key: "contextTimeline",
    stateVersion: 1,
    init: () => ({ system: 0, tools: 0, messages: 0 }),
    apply(state, event: SessionEvent): ContextTimelineState {
      let next: ContextTimelineState = state;

      if (event.type === "request/header") {
        const system = estimateSystemTokens(event.header.system);
        const tools = estimateToolsTokens(event.header.tools);
        const model = event.header.config.model;
        const provider = event.header.config.provider;
        const contextWindow = event.header.config.contextWindow;
        next = {
          system,
          tools,
          messages: next.messages,
          ...(typeof model === "string" && model
            ? { model }
            : next.model !== undefined
              ? { model: next.model }
              : {}),
          ...(typeof provider === "string" && provider
            ? { provider }
            : next.provider !== undefined
              ? { provider: next.provider }
              : {}),
          ...(typeof contextWindow === "number"
            ? { contextWindow }
            : next.contextWindow !== undefined
              ? { contextWindow: next.contextWindow }
              : {}),
        };
      }

      const messages = foldSurfaceTokens(next.messages, event);
      if (messages !== next.messages) {
        next = { ...next, messages };
      }

      return next;
    },
    wire: {
      view: viewOf,
      parse(value: unknown): ContextTimelineProjection {
        if (!value || typeof value !== "object") {
          throw new Error("contextTimeline projection must be an object");
        }
        const v = value as Record<string, unknown>;
        const current =
          v.current && typeof v.current === "object"
            ? (v.current as Record<string, unknown>)
            : {};
        const model = typeof v.model === "string" ? v.model : undefined;
        const provider =
          typeof v.provider === "string" ? v.provider : undefined;
        const contextWindow = asOptPositiveInt(
          v.contextWindow,
          "contextTimeline",
          "contextWindow",
        );
        return {
          current: {
            system: asNonNegInt(current.system, "contextTimeline", "system"),
            tools: asNonNegInt(current.tools, "contextTimeline", "tools"),
            user: asNonNegInt(current.user, "contextTimeline", "user"),
            inject: asNonNegInt(current.inject, "contextTimeline", "inject"),
            assistant: asNonNegInt(
              current.assistant,
              "contextTimeline",
              "assistant",
            ),
            tool: asNonNegInt(current.tool, "contextTimeline", "tool"),
            total: asNonNegInt(current.total, "contextTimeline", "total"),
          },
          toolList: Array.isArray(v.toolList) ? v.toolList : [],
          requests: Array.isArray(v.requests) ? v.requests : [],
          events: Array.isArray(v.events) ? v.events : [],
          nodes: Array.isArray(v.nodes) ? v.nodes : [],
          archive: Array.isArray(v.archive) ? v.archive : [],
          droppedNodes: asNonNegInt(
            v.droppedNodes ?? 0,
            "contextTimeline",
            "droppedNodes",
          ),
          ...(model !== undefined ? { model } : {}),
          ...(provider !== undefined ? { provider } : {}),
          ...(contextWindow !== undefined ? { contextWindow } : {}),
        };
      },
    },
  };
}
