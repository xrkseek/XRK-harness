import type { ChatMessage } from "@xrkseek/protocol";

export interface AssembledRequest {
  readonly system: string;
  readonly messages: readonly ChatMessage[];
  readonly tools: readonly {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  }[];
}

export interface SkeletonSystemInput {
  readonly persona?: string;
  readonly mcpProtocol?: string;
}

export interface SkeletonUserInput {
  readonly text: string;
  /** Multimodal placeholder — ignored in M1 text path. */
  readonly attachments?: readonly unknown[];
}

export interface VolatileUserInput {
  readonly nowIso: string;
  readonly sessionId: string;
  readonly owner?: string;
}

export interface ThreeLayerInput {
  readonly skeletonSystem: SkeletonSystemInput;
  readonly history: readonly ChatMessage[];
  readonly skeletonUser: SkeletonUserInput;
  readonly volatile: VolatileUserInput;
  readonly tools?: AssembledRequest["tools"];
  readonly workspaceBlocks?: readonly string[];
  /**
   * When false, omit the `[current message]` marker (follow-up steps).
   * Leaving the marker after growing history moves it each step and busts
   * DeepSeek-style prompt-prefix cache for the conversation body.
   */
  readonly includeCurrentMarker?: boolean;
  /**
   * When false, omit `time:` from volatile (follow-up steps). Session id stays
   * so the volatile suffix can stay byte-stable across a turn's tool loop.
   */
  readonly includeVolatileTime?: boolean;
  /**
   * Optional tool wire order (DSH `toolOrder`). Exactly one `' '` rest marker;
   * named tools before/after the rest appear in that order, remaining tools
   * fill the rest slot in lexicographic order. Omit / empty → pure lex sort.
   * Unknown names, duplicates, or wrong rest count throw.
   */
  readonly toolOrder?: readonly string[];
}

export function buildSkeletonSystem(input: SkeletonSystemInput): string {
  const parts = [
    input.persona?.trim() || "You are a helpful coding agent.",
    input.mcpProtocol?.trim() || "",
  ].filter(Boolean);
  return parts.join("\n\n");
}

export function buildSkeletonUser(input: SkeletonUserInput): ChatMessage {
  const attachmentNote =
    input.attachments && input.attachments.length > 0
      ? `\n\n[attachments: ${input.attachments.length} placeholder(s)]`
      : "";
  return {
    role: "user",
    content: `${input.text}${attachmentNote}`,
  };
}

export function buildVolatileUser(
  input: VolatileUserInput,
  options: { readonly includeTime?: boolean } = {},
): ChatMessage {
  const includeTime = options.includeTime !== false;
  const lines = [
    ...(includeTime ? [`time: ${input.nowIso}`] : []),
    `session: ${input.sessionId}`,
  ];
  if (input.owner) lines.push(`owner: ${input.owner}`);
  return {
    role: "user",
    content: `[volatile]\n${lines.join("\n")}`,
  };
}

/** History transcript; optional current-message marker before the live user turn. */
export function mergeHistory(
  history: readonly ChatMessage[],
  options: { readonly includeCurrentMarker?: boolean } = {},
): ChatMessage[] {
  if (history.length === 0) return [];
  const includeMarker = options.includeCurrentMarker !== false;
  if (!includeMarker) return [...history];
  return [
    ...history,
    {
      role: "user",
      content: "[current message]",
    },
  ];
}

/** Lexicographic tool order — registration order must not leak to the wire. */
export const TOOL_ORDER_REST = " " as const;

/**
 * Order tools for the wire.
 * @param tools - tool definitions for this request
 * @param toolOrder - optional DSH-style order with exactly one `' '` rest
 */
export function orderToolsForWire(
  tools: AssembledRequest["tools"],
  toolOrder?: readonly string[],
): AssembledRequest["tools"] {
  const lex = [...tools].sort((a, b) =>
    a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
  );
  if (!toolOrder || toolOrder.length === 0) return lex;

  const restMarks = toolOrder.filter((x) => x === TOOL_ORDER_REST);
  if (restMarks.length !== 1) {
    throw new Error(
      `toolOrder must contain exactly one ' ' rest marker (got ${restMarks.length})`,
    );
  }
  const named = toolOrder.filter((x) => x !== TOOL_ORDER_REST);
  if (new Set(named).size !== named.length) {
    throw new Error("toolOrder must not list the same tool name twice");
  }
  const byName = new Map(tools.map((t) => [t.name, t] as const));
  for (const name of named) {
    if (!byName.has(name)) {
      throw new Error(`toolOrder references unknown tool: ${name}`);
    }
  }
  const restIdx = toolOrder.indexOf(TOOL_ORDER_REST);
  const before = toolOrder.slice(0, restIdx).filter((x) => x !== TOOL_ORDER_REST);
  const after = toolOrder.slice(restIdx + 1).filter((x) => x !== TOOL_ORDER_REST);
  const pinned = new Set([...before, ...after]);
  const middle = lex.filter((t) => !pinned.has(t.name));
  const pick = (names: readonly string[]) =>
    names.map((n) => {
      const t = byName.get(n);
      if (!t) throw new Error(`toolOrder references unknown tool: ${n}`);
      return t;
    });
  return [...pick(before), ...middle, ...pick(after)];
}

/**
 * Fixed order:
 * 1. system = skeleton system (+ optional workspace blocks appended)
 * 2. messages = history(+optional marker) + skeleton user + volatile user
 * Volatile content must never appear in `system`.
 * Tools are sorted by name (or `toolOrder`) for prompt-cache stability (DSH parity).
 */
export function assembleThreeLayers(
  input: ThreeLayerInput,
): AssembledRequest {
  const systemParts = [buildSkeletonSystem(input.skeletonSystem)];
  if (input.workspaceBlocks?.length) {
    systemParts.push(...input.workspaceBlocks);
  }
  const system = systemParts.filter((s) => s.trim()).join("\n\n");
  const messages: ChatMessage[] = [
    ...mergeHistory(
      input.history,
      input.includeCurrentMarker === undefined
        ? {}
        : { includeCurrentMarker: input.includeCurrentMarker },
    ),
    buildSkeletonUser(input.skeletonUser),
    buildVolatileUser(
      input.volatile,
      input.includeVolatileTime === undefined
        ? {}
        : { includeTime: input.includeVolatileTime },
    ),
  ];
  return {
    system,
    messages,
    tools: orderToolsForWire(input.tools ?? [], input.toolOrder),
  };
}
