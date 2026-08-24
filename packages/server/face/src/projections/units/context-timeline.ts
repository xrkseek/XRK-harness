/**
 * DSH `contextTimeline` for community `dsh-context` tab.
 * Folds request headers into system/tools + toolList, and model-visible
 * messages into `nodes` (cat counts drive the browser “N 项” labels).
 */
import type { MessageContent, SessionEvent } from "@xrkseek/protocol";
import {
  flattenText,
  isHumanUserMessageSource,
} from "@xrkseek/protocol";
import {
  estimateAssistantSurface,
  estimateMessageContent,
  estimateSystemTokens,
  estimateToolsTokens,
  formatCompactionForModel,
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
  readonly toolList: readonly ContextTimelineTool[];
  readonly requests: readonly ContextTimelineRequest[];
  readonly events: readonly unknown[];
  readonly nodes: readonly ContextTimelineNode[];
  readonly archive: readonly ContextTimelineNode[];
  readonly droppedNodes: number;
  readonly model?: string;
  readonly provider?: string;
  readonly contextWindow?: number;
}

export interface ContextTimelineTool {
  readonly name: string;
  readonly description: string;
  readonly schema: Record<string, unknown>;
  readonly tokens: number;
}

export interface ContextTimelineRequest {
  readonly seq: number;
  readonly turn: number;
  readonly step: number;
  readonly time: number;
  readonly prompt: number;
}

export type ContextTimelineCat =
  | "user"
  | "inject"
  | "assistant"
  | "tool";

export interface ContextTimelineNode {
  readonly cat: ContextTimelineCat;
  readonly seq: number;
  readonly tokens: number;
  readonly time: number;
  readonly text?: string;
  readonly form?: string;
  readonly skill?: string;
  readonly calls?: readonly string[];
  readonly tool?: string;
  readonly callId?: string;
  readonly err?: boolean;
  /** When set, node left the live surface after this request seq. */
  readonly gone?: number;
}

interface ContextTimelineState {
  readonly applied: number;
  readonly system: number;
  readonly tools: number;
  readonly toolList: readonly ContextTimelineTool[];
  readonly requests: readonly ContextTimelineRequest[];
  readonly nodes: readonly ContextTimelineNode[];
  readonly archive: readonly ContextTimelineNode[];
  readonly turnOrdinal: number;
  readonly stepOrdinal: number;
  readonly model?: string;
  readonly provider?: string;
  readonly contextWindow?: number;
}

const PREVIEW_MAX = 240;

function previewText(content: MessageContent | string): string {
  const raw =
    typeof content === "string" ? content : flattenText(content);
  if (raw.length <= PREVIEW_MAX) return raw;
  return `${raw.slice(0, PREVIEW_MAX)}…`;
}

function toolListOf(
  tools:
    | readonly {
        readonly name: string;
        readonly description: string;
        readonly parameters: Record<string, unknown>;
      }[]
    | undefined,
): ContextTimelineTool[] {
  if (!tools?.length) return [];
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    schema: tool.parameters,
    tokens: estimateToolsTokens([tool]),
  }));
}

function sumCat(
  nodes: readonly ContextTimelineNode[],
  cat: ContextTimelineCat,
): number {
  let n = 0;
  for (const node of nodes) {
    if (node.cat === cat) n += node.tokens;
  }
  return n;
}

function viewOf(state: ContextTimelineState): ContextTimelineProjection {
  const user = sumCat(state.nodes, "user");
  const inject = sumCat(state.nodes, "inject");
  const assistant = sumCat(state.nodes, "assistant");
  const tool = sumCat(state.nodes, "tool");
  const total = Math.max(
    0,
    state.system + state.tools + user + inject + assistant + tool,
  );
  return {
    current: {
      system: state.system,
      tools: state.tools,
      user,
      inject,
      assistant,
      tool,
      total,
    },
    toolList: state.toolList,
    requests: state.requests,
    events: [],
    nodes: state.nodes,
    archive: state.archive,
    droppedNodes: 0,
    ...(state.model !== undefined ? { model: state.model } : {}),
    ...(state.provider !== undefined ? { provider: state.provider } : {}),
    ...(state.contextWindow !== undefined
      ? { contextWindow: state.contextWindow }
      : {}),
  };
}

function withApplied(
  state: ContextTimelineState,
  seq: number,
  patch: Partial<ContextTimelineState>,
): ContextTimelineState {
  return { ...state, ...patch, applied: seq };
}

/**
 * Publish timeline with nodes + toolList so dsh-context item counts match
 * the heuristic token surface (system/tools from header; messages from nodes).
 */
export function createContextTimelineProjectionUnit(): ProjectionDefinition<
  "contextTimeline",
  ContextTimelineState,
  ContextTimelineProjection
> {
  return {
    key: "contextTimeline",
    stateVersion: 2,
    init: () => ({
      applied: 0,
      system: 0,
      tools: 0,
      toolList: [],
      requests: [],
      nodes: [],
      archive: [],
      turnOrdinal: 0,
      stepOrdinal: 0,
    }),
    apply(state, event: SessionEvent): ContextTimelineState {
      const seq = state.applied + 1;
      const next = withApplied(state, seq, {});

      if (event.type === "turn/start") {
        return withApplied(next, seq, {
          turnOrdinal: next.turnOrdinal + 1,
          stepOrdinal: 0,
        });
      }

      if (event.type === "step/start") {
        return withApplied(next, seq, {
          stepOrdinal: next.stepOrdinal + 1,
        });
      }

      if (event.type === "request/header") {
        const system = estimateSystemTokens(event.header.system);
        const tools = estimateToolsTokens(event.header.tools);
        const toolList = toolListOf(event.header.tools);
        const model = event.header.config.model;
        const provider = event.header.config.provider;
        const contextWindow = event.header.config.contextWindow;
        const messageTokens =
          sumCat(next.nodes, "user") +
          sumCat(next.nodes, "inject") +
          sumCat(next.nodes, "assistant") +
          sumCat(next.nodes, "tool");
        const request: ContextTimelineRequest = {
          seq,
          turn: next.turnOrdinal,
          step: next.stepOrdinal,
          time: event.ts,
          prompt: system + tools + messageTokens,
        };
        return withApplied(next, seq, {
          system,
          tools,
          toolList,
          requests: [...next.requests, request],
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
        });
      }

      if (event.type === "user/message") {
        const tokens = estimateMessageContent(event.content);
        const human = isHumanUserMessageSource(event.source);
        const text = previewText(event.content);
        const node: ContextTimelineNode = human
          ? {
              cat: "user",
              seq,
              tokens,
              time: event.ts,
              ...(text ? { text } : {}),
            }
          : {
              cat: "inject",
              seq,
              tokens,
              time: event.ts,
              form:
                event.source && "form" in event.source
                  ? String(event.source.form ?? "context")
                  : "context",
              ...(event.source?.kind === "skill-catalog"
                ? { skill: "catalog" }
                : {}),
              ...(text ? { text } : {}),
            };
        return withApplied(next, seq, {
          nodes: [...next.nodes, node],
        });
      }

      if (event.type === "assistant/message") {
        const tokens = estimateAssistantSurface(
          event.content,
          event.toolCalls,
        );
        const calls = event.toolCalls?.map((c) => c.name);
        const text = previewText(event.content);
        const node: ContextTimelineNode = {
          cat: "assistant",
          seq,
          tokens,
          time: event.ts,
          ...(text ? { text } : {}),
          ...(calls?.length ? { calls } : {}),
        };
        return withApplied(next, seq, {
          nodes: [...next.nodes, node],
        });
      }

      if (event.type === "tool/result") {
        const tokens = estimateMessageContent(event.result.content);
        const text = previewText(event.result.content);
        const callId = event.result.toolCallId;
        const node: ContextTimelineNode = {
          cat: "tool",
          seq,
          tokens,
          time: event.ts,
          tool: event.result.name,
          callId,
          ...(event.result.isError ? { err: true } : {}),
          ...(text ? { text } : {}),
        };
        const withoutPrior = next.nodes.filter((n) => n.callId !== callId);
        return withApplied(next, seq, {
          nodes: [...withoutPrior, node],
        });
      }

      if (
        event.type === "context/compaction" &&
        event.shadowedTokenCount !== undefined
      ) {
        const archive = [
          ...next.archive,
          ...next.nodes.map((n) => ({ ...n, gone: seq })),
        ];
        const content = formatCompactionForModel(event);
        const tokens = estimateMessageContent(content);
        const text = previewText(content);
        const node: ContextTimelineNode = {
          cat: "inject",
          seq,
          tokens,
          time: event.ts,
          form: "snapshot",
          ...(text ? { text } : {}),
        };
        return withApplied(next, seq, {
          archive,
          nodes: [node],
        });
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
          toolList: Array.isArray(v.toolList)
            ? (v.toolList as ContextTimelineTool[])
            : [],
          requests: Array.isArray(v.requests)
            ? (v.requests as ContextTimelineRequest[])
            : [],
          events: Array.isArray(v.events) ? v.events : [],
          nodes: Array.isArray(v.nodes)
            ? (v.nodes as ContextTimelineNode[])
            : [],
          archive: Array.isArray(v.archive)
            ? (v.archive as ContextTimelineNode[])
            : [],
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
