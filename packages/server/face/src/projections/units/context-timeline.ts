/**
 * DSH `contextTimeline` for community `dsh-context` tab.
 * Folds request headers into system/tools + toolList, and model-visible
 * messages into `nodes` (cat counts drive the browser “N 项” labels).
 *
 * Request rows match dsh-context wire: heuristic cats live on `total` /
 * `system`…`tool`; provider usage stamps optional `prompt` / `output`.
 * Context events (inject · compaction · prune · model · mode) fill `events`.
 */
import type { MessageContent, SessionEvent } from "@xrkseek/protocol";
import {
  flattenText,
  inputPressureTokens,
  isHumanUserMessageSource,
  usageFromSessionEvent,
} from "@xrkseek/protocol";
import {
  estimateAssistantSurface,
  estimateMessageContent,
  estimateSystemTokens,
  estimateToolsTokens,
  formatCompactionForModel,
  TOOL_RESULT_PRUNE_META_PREV_TOKENS,
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
  readonly events: readonly ContextTimelineEvent[];
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

/**
 * One model request sample for the trend chart.
 * `total` + cats = heuristic; `prompt` / `output` = provider when known.
 */
export interface ContextTimelineRequest {
  readonly seq: number;
  readonly turn: number;
  readonly step: number;
  readonly time: number;
  readonly total: number;
  readonly system: number;
  readonly tools: number;
  readonly user: number;
  readonly inject: number;
  readonly assistant: number;
  readonly tool: number;
  /** Provider-reported prompt / input occupancy (actual). */
  readonly prompt?: number;
  readonly output?: number;
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

/** Boundary / inject markers for the dsh-context events list. */
export type ContextTimelineEvent =
  | {
      readonly kind: "inject";
      readonly seq: number;
      readonly turn: number;
      readonly step: number;
      readonly time: number;
      readonly form?: string;
      readonly sub?: "skill";
      readonly name?: string;
    }
  | {
      readonly kind: "compaction";
      readonly seq: number;
      readonly turn: number;
      readonly step: number;
      readonly time: number;
      readonly count: number;
    }
  | {
      readonly kind: "prune";
      readonly seq: number;
      readonly turn: number;
      readonly step: number;
      readonly time: number;
    }
  | {
      readonly kind: "model";
      readonly seq: number;
      readonly turn: number;
      readonly step: number;
      readonly time: number;
      readonly from: string;
      readonly to: string;
    }
  | {
      readonly kind: "mode";
      readonly seq: number;
      readonly turn: number;
      readonly step: number;
      readonly time: number;
      readonly name: "plan.on" | "plan.off";
    };

interface ContextTimelineState {
  readonly applied: number;
  readonly system: number;
  readonly tools: number;
  readonly toolList: readonly ContextTimelineTool[];
  readonly requests: readonly ContextTimelineRequest[];
  readonly events: readonly ContextTimelineEvent[];
  readonly nodes: readonly ContextTimelineNode[];
  readonly archive: readonly ContextTimelineNode[];
  readonly turnOrdinal: number;
  readonly stepOrdinal: number;
  readonly model?: string;
  readonly provider?: string;
  readonly contextWindow?: number;
}

const PREVIEW_MAX = 120;

function previewText(content: MessageContent): string | undefined {
  const raw = flattenText(content).replace(/\s+/g, " ").trim();
  if (!raw) return undefined;
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

function catsOf(
  system: number,
  tools: number,
  nodes: readonly ContextTimelineNode[],
): Pick<
  ContextTimelineRequest,
  "system" | "tools" | "user" | "inject" | "assistant" | "tool" | "total"
> {
  const user = sumCat(nodes, "user");
  const inject = sumCat(nodes, "inject");
  const assistant = sumCat(nodes, "assistant");
  const tool = sumCat(nodes, "tool");
  return {
    system,
    tools,
    user,
    inject,
    assistant,
    tool,
    total: Math.max(0, system + tools + user + inject + assistant + tool),
  };
}

function viewOf(state: ContextTimelineState): ContextTimelineProjection {
  const cats = catsOf(state.system, state.tools, state.nodes);
  return {
    current: cats,
    toolList: state.toolList,
    requests: state.requests,
    events: state.events,
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

function stampUsageOnLatestRequest(
  requests: readonly ContextTimelineRequest[],
  usage: NonNullable<ReturnType<typeof usageFromSessionEvent>>,
): readonly ContextTimelineRequest[] | undefined {
  if (requests.length === 0) return undefined;
  const last = requests[requests.length - 1]!;
  const prompt = inputPressureTokens(usage);
  const output = usage.outputTokens;
  if (last.prompt === prompt && last.output === output) return undefined;
  return [
    ...requests.slice(0, -1),
    {
      ...last,
      prompt,
      ...(typeof output === "number" ? { output } : {}),
    },
  ];
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
    stateVersion: 3,
    init: () => ({
      applied: 0,
      system: 0,
      tools: 0,
      toolList: [],
      requests: [],
      events: [],
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
        const cats = catsOf(system, tools, next.nodes);
        const request: ContextTimelineRequest = {
          seq,
          turn: next.turnOrdinal,
          step: next.stepOrdinal,
          time: event.ts,
          ...cats,
        };
        let events = next.events;
        if (
          typeof model === "string" &&
          model &&
          next.model !== undefined &&
          next.model !== model
        ) {
          events = [
            ...events,
            {
              kind: "model",
              seq,
              turn: next.turnOrdinal,
              step: next.stepOrdinal,
              time: event.ts,
              from: next.model,
              to: model,
            },
          ];
        }
        return withApplied(next, seq, {
          system,
          tools,
          toolList,
          requests: [...next.requests, request],
          events,
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
        let events = next.events;
        if (!human) {
          const form =
            event.source && "form" in event.source
              ? String(event.source.form ?? "context")
              : "context";
          const isCatalog = event.source?.kind === "skill-catalog";
          const pluginName =
            event.source?.kind === "plugin" &&
            typeof event.source.plugin === "string"
              ? event.source.plugin
              : undefined;
          events = [
            ...events,
            {
              kind: "inject",
              seq,
              turn: next.turnOrdinal,
              step: next.stepOrdinal,
              time: event.ts,
              form,
              ...(isCatalog
                ? { sub: "skill" as const, name: "catalog" }
                : pluginName
                  ? { name: pluginName }
                  : {}),
            },
          ];
        }
        return withApplied(next, seq, {
          nodes: [...next.nodes, node],
          events,
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
        let requests = next.requests;
        const usage = usageFromSessionEvent(event);
        if (usage) {
          const stamped = stampUsageOnLatestRequest(requests, usage);
          if (stamped) requests = stamped;
        }
        return withApplied(next, seq, {
          nodes: [...next.nodes, node],
          requests,
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
        let events = next.events;
        const prevTok = event.result.meta?.[TOOL_RESULT_PRUNE_META_PREV_TOKENS];
        if (typeof prevTok === "number" && Number.isFinite(prevTok)) {
          events = [
            ...events,
            {
              kind: "prune",
              seq,
              turn: next.turnOrdinal,
              step: next.stepOrdinal,
              time: event.ts,
            },
          ];
        }
        return withApplied(next, seq, {
          nodes: [...withoutPrior, node],
          events,
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
          events: [
            ...next.events,
            {
              kind: "compaction",
              seq,
              turn: next.turnOrdinal,
              step: next.stepOrdinal,
              time: event.ts,
              count: next.nodes.length,
            },
          ],
        });
      }

      if (event.type === "plan/mode") {
        return withApplied(next, seq, {
          events: [
            ...next.events,
            {
              kind: "mode",
              seq,
              turn: next.turnOrdinal,
              step: next.stepOrdinal,
              time: event.ts,
              name: event.active ? "plan.on" : "plan.off",
            },
          ],
        });
      }

      // Early usage on chunks can stamp the open request before the message.
      if (event.type === "assistant/chunk") {
        const usage = usageFromSessionEvent(event);
        if (usage) {
          const stamped = stampUsageOnLatestRequest(next.requests, usage);
          if (stamped) {
            return withApplied(next, seq, { requests: stamped });
          }
        }
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
          events: Array.isArray(v.events)
            ? (v.events as ContextTimelineEvent[])
            : [],
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
