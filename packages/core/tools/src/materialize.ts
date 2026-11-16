import type { ToolCall } from "@xrkseek/protocol";
import {
  errorToolResult,
  freezeToolResult,
  type ToolDefinition,
  type ToolDynamicSchema,
  type ToolRegistry,
} from "./definition.js";
import { runToolPipeline } from "./pipeline.js";
import type { RunToolOutcome, ToolPipeline } from "./types.js";
import { listForModel } from "./tool-exposure.js";

export type ToolResolveError = "unknown" | "stale";

export interface ToolMaterialization {
  /**
   * Full registry snapshot for settle (live identity; no dynamicSchema merge).
   * Wire catalog is {@link ToolMaterialization.list} only.
   */
  readonly definitions: readonly ToolDefinition[];
  list(): readonly ToolDefinition[];
  /**
   * Resolve a call against the snapshot.
   * - unknown: not in snapshot
   * - stale: was in snapshot but live registry no longer has the same tool instance
   */
  resolve(
    name: string,
  ):
    | { readonly ok: true; readonly tool: ToolDefinition }
    | { readonly ok: false; readonly error: ToolResolveError };
  settle(input: {
    readonly call: ToolCall;
    readonly signal?: AbortSignal;
    readonly pipeline?: ToolPipeline;
    readonly timeoutMs?: number;
    readonly maxRetries?: number;
    readonly sessionId?: string;
    readonly runId?: string;
  }): Promise<RunToolOutcome>;
}

export interface MaterializeToolsOptions {
  /**
   * Catalog-only filter: omit these names from the snapshot (not execution auth).
   * Guards remain the authorization boundary.
   */
  readonly omitNames?: ReadonlySet<string> | readonly string[];
  /**
   * Session-expanded Deferred tool names for progressive disclosure.
   * Affects {@link ToolMaterialization.list} only — settle still resolves the
   * full registry snapshot (including not-yet-expanded Deferred).
   */
  readonly expandedToolNames?: ReadonlySet<string>;
}

/**
 * Apply Hermes-style `dynamicSchema()` onto a catalog view.
 * Soft-fail keeps the static description/parameters. Returns `tool` unchanged
 * when there is no override (preserves object identity for settle).
 */
export function applyToolDynamicSchema(tool: ToolDefinition): ToolDefinition {
  if (typeof tool.dynamicSchema !== "function") return tool;
  let overrides: ToolDynamicSchema | undefined;
  try {
    overrides = tool.dynamicSchema();
  } catch {
    return tool;
  }
  if (
    !overrides ||
    (overrides.description === undefined && overrides.parameters === undefined)
  ) {
    return tool;
  }
  return {
    ...tool,
    ...(overrides.description !== undefined
      ? { description: overrides.description }
      : {}),
    ...(overrides.parameters !== undefined
      ? { parameters: overrides.parameters }
      : {}),
  };
}

/**
 * Freeze the tool table for one provider step / turn slice.
 * Wire catalog merges {@link ToolDefinition.dynamicSchema} only for tools that
 * pass progressive disclosure; settle uses live registry identity so overrides
 * never flip settle to stale.
 */
export function materializeTools(
  registry: ToolRegistry,
  options: MaterializeToolsOptions = {},
): ToolMaterialization {
  const omit =
    options.omitNames === undefined
      ? undefined
      : options.omitNames instanceof Set
        ? options.omitNames
        : new Set(options.omitNames);

  const live = registry.list().filter((t) => !omit?.has(t.name));
  /** Live identity for settle / stale checks. */
  const snap = new Map(live.map((t) => [t.name, t] as const));
  /** Full snap for settle — dynamicSchema only on the wire catalog below. */
  const definitions = live;

  const resolve = (
    name: string,
  ):
    | { readonly ok: true; readonly tool: ToolDefinition }
    | { readonly ok: false; readonly error: ToolResolveError } => {
    const captured = snap.get(name);
    if (!captured) {
      return { ok: false, error: "unknown" };
    }
    const current = registry.get(name);
    if (current !== captured) {
      return { ok: false, error: "stale" };
    }
    return { ok: true, tool: captured };
  };

  // Filter first so deferred MCP never pays dynamicSchema until expanded.
  const catalog = listForModel(live, {
    ...(options.expandedToolNames
      ? { expandedNames: options.expandedToolNames }
      : {}),
  }).map(applyToolDynamicSchema);

  return {
    definitions,
    list() {
      return catalog;
    },
    resolve,
    async settle(input) {
      const resolved = resolve(input.call.name);
      if (!resolved.ok) {
        const content =
          resolved.error === "stale"
            ? `Stale tool call: ${input.call.name}`
            : `Unknown tool: ${input.call.name}`;
        return {
          result: freezeToolResult(
            errorToolResult(input.call.id, input.call.name, content),
          ),
          additionalContexts: [],
          safetyNotices: [],
          toolEvents: [],
          stages: ["result"],
          skippedBody: true,
        };
      }
      return runToolPipeline(
        resolved.tool,
        input.call,
        input.signal,
        input.pipeline,
        {
          ...(input.timeoutMs !== undefined
            ? { timeoutMs: input.timeoutMs }
            : {}),
          ...(input.maxRetries !== undefined
            ? { maxRetries: input.maxRetries }
            : {}),
          ...(input.sessionId !== undefined
            ? { sessionId: input.sessionId }
            : {}),
          ...(input.runId !== undefined ? { runId: input.runId } : {}),
        },
      );
    },
  };
}
