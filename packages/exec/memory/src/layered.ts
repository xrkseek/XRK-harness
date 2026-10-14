/**
 * Layered curated memory: one tool surface, independent zones (global /
 * workspace / session / agent). Frozen system prompt concatenates each zone.
 */
import type { ToolDefinition, ToolResultContent } from "@xrkseek/core-tools";
import {
  createCuratedMemoryStore,
  type CuratedMemoryOperation,
  type CuratedMemoryStore,
  type CuratedMemoryTarget,
  type CuratedMemoryWriteResult,
  type MemoryEntryAge,
  type MaybeAsync,
} from "./store.js";
import {
  canOpenCuratedMemoryScope,
  curatedMemoryDirFor,
  CURATED_MEMORY_SCOPE_KINDS,
  type CuratedMemoryScopeIds,
  type CuratedMemoryScopeKind,
} from "./scopes.js";
import { createCuratedMemoryTools, CURATED_MEMORY_PROMPT_TEXT } from "./tools.js";

export interface MemoryScopeLayer {
  readonly scope: CuratedMemoryScopeKind;
  readonly store: CuratedMemoryStore;
}

export interface CreateLayeredCuratedMemoryStoreOptions
  extends CuratedMemoryScopeIds {
  /**
   * Default write/list target when the tool omits `scope`.
   * Prefer session when present, else workspace, else global.
   */
  readonly defaultScope?: CuratedMemoryScopeKind;
}

const SCOPE_HEADERS: Record<CuratedMemoryScopeKind, string> = {
  global: "GLOBAL curated memory (home-wide)",
  workspace: "WORKSPACE curated memory",
  session: "SESSION curated memory (this conversation)",
  agent: "AGENT curated memory (this 干员 / roster member)",
};

function pickDefaultScope(
  layers: readonly MemoryScopeLayer[],
  preferred?: CuratedMemoryScopeKind,
): CuratedMemoryScopeKind {
  if (preferred && layers.some((l) => l.scope === preferred)) return preferred;
  for (const kind of ["session", "workspace", "agent", "global"] as const) {
    if (layers.some((l) => l.scope === kind)) return kind;
  }
  return "global";
}

/** Open every zone that has ids; always includes global. */
export function openCuratedMemoryLayers(
  ids: CuratedMemoryScopeIds,
): MemoryScopeLayer[] {
  const layers: MemoryScopeLayer[] = [];
  for (const scope of CURATED_MEMORY_SCOPE_KINDS) {
    if (!canOpenCuratedMemoryScope(scope, ids)) continue;
    layers.push({
      scope,
      store: createCuratedMemoryStore({
        dir: curatedMemoryDirFor(scope, ids),
        ...(ids.env ? { env: ids.env } : {}),
      }),
    });
  }
  return layers;
}

/**
 * A {@link CuratedMemoryStore} facade over several zones.
 * Mutations hit `defaultScope`; {@link frozenSystemBlock} merges all zones.
 */
export function createLayeredCuratedMemoryStore(
  options: CreateLayeredCuratedMemoryStoreOptions,
): CuratedMemoryStore & {
  readonly layers: readonly MemoryScopeLayer[];
  readonly defaultScope: CuratedMemoryScopeKind;
  storeFor(scope: CuratedMemoryScopeKind): CuratedMemoryStore | undefined;
} {
  const layers = openCuratedMemoryLayers(options);
  const defaultScope = pickDefaultScope(layers, options.defaultScope);
  const byScope = new Map(layers.map((l) => [l.scope, l.store] as const));
  const primary = byScope.get(defaultScope) ?? layers[0]!.store;

  const storeFor = (scope: CuratedMemoryScopeKind) => byScope.get(scope);

  const facade: CuratedMemoryStore & {
    readonly layers: readonly MemoryScopeLayer[];
    readonly defaultScope: CuratedMemoryScopeKind;
    storeFor(scope: CuratedMemoryScopeKind): CuratedMemoryStore | undefined;
  } = {
    dir: primary.dir,
    layers,
    defaultScope,
    storeFor,
    frozenPrompt(target) {
      return primary.frozenPrompt(target);
    },
    frozenSystemBlock() {
      const parts: string[] = [];
      for (const layer of layers) {
        const body = layer.store.frozenSystemBlock().trim();
        if (!body) continue;
        parts.push(`### ${SCOPE_HEADERS[layer.scope]}\n${body}`);
      }
      return parts.join("\n\n");
    },
    listEntries(target) {
      return primary.listEntries(target);
    },
    add(target, content) {
      return primary.add(target, content);
    },
    replace(target, oldText, content) {
      return primary.replace(target, oldText, content);
    },
    remove(target, oldText) {
      return primary.remove(target, oldText);
    },
    applyBatch(target, operations) {
      return primary.applyBatch(target, operations);
    },
    staleEntries(target, limit) {
      return primary.staleEntries?.(target, limit) ?? [];
    },
  };
  return facade;
}

function asScope(
  raw: unknown,
  fallback: CuratedMemoryScopeKind,
): CuratedMemoryScopeKind | undefined {
  if (raw === undefined || raw === null || raw === "") return fallback;
  const s = String(raw).trim();
  if ((CURATED_MEMORY_SCOPE_KINDS as readonly string[]).includes(s)) {
    return s as CuratedMemoryScopeKind;
  }
  return undefined;
}

/**
 * `memory` tool with a `scope` field (global|workspace|session|agent).
 * Falls back to {@link createCuratedMemoryTools} when only one layer exists.
 */
export function createScopedCuratedMemoryTools(
  layered: ReturnType<typeof createLayeredCuratedMemoryStore>,
): ToolDefinition[] {
  if (layered.layers.length <= 1) {
    return createCuratedMemoryTools(layered);
  }
  const base = createCuratedMemoryTools(layered)[0]!;
  const available = layered.layers.map((l) => l.scope);

  const tool: ToolDefinition = {
    ...base,
    description:
      `${base.description} ` +
      `Optional scope (${available.join("|")}) picks an independent zone — ` +
      `default ${layered.defaultScope}. Zones do not share entries.`,
    parameters: {
      type: "object",
      properties: {
        ...(base.parameters as { properties: Record<string, unknown> }).properties,
        scope: {
          type: "string",
          enum: [...available],
          description:
            "Memory zone: global (home) · workspace · session · agent (干员). " +
            `Default ${layered.defaultScope}.`,
        },
      },
      required: ["target"],
    },
    async execute(args): Promise<ToolResultContent> {
      const a =
        args && typeof args === "object"
          ? (args as Record<string, unknown>)
          : {};
      const scope = asScope(a.scope, layered.defaultScope);
      if (!scope) {
        return {
          isError: true,
          content: JSON.stringify({
            success: false,
            error: `Invalid memory scope '${String(a.scope)}'. Use: ${available.join(", ")}`,
          }),
        };
      }
      const store = layered.storeFor(scope);
      if (!store) {
        return {
          isError: true,
          content: JSON.stringify({
            success: false,
            error: `Memory scope '${scope}' is not available for this session.`,
          }),
        };
      }
      const [scopedTool] = createCuratedMemoryTools(store);
      const out = await scopedTool!.execute(args);
      if (typeof out.content === "string" && out.content.startsWith("{")) {
        try {
          const json = JSON.parse(out.content) as Record<string, unknown>;
          return {
            ...out,
            content: JSON.stringify({ ...json, scope }),
          };
        } catch {
          /* keep original */
        }
      }
      return out;
    },
  };
  return [tool];
}

/** Policy text mentioning independent zones (when layered). */
export const SCOPED_CURATED_MEMORY_PROMPT_TEXT =
  CURATED_MEMORY_PROMPT_TEXT +
  " Independent zones share the same tool: scope=global|workspace|session|agent. " +
  "Use session for this conversation's facts, agent for a 干员's private notes, " +
  "workspace for project-wide facts, global for home-wide preferences.";

/** Re-export write helpers typing for layered facades. */
export type {
  CuratedMemoryOperation,
  CuratedMemoryTarget,
  CuratedMemoryWriteResult,
  MemoryEntryAge,
  MaybeAsync,
};
