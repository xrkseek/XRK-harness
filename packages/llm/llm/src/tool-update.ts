/**
 * Mid-conversation tool declaration projection (DSH `ToolUpdate` subset).
 *
 * `'addition-only'`: new tools ride the cached tools[] prefix with
 * `deferLoading` + a later activation (`tool_addition` on Messages). Removals
 * rebuild the baseline (addition-only cannot express removal in history).
 * Absent / unsupported routes strip `deferLoading` and send the full active set.
 */

export type ToolUpdate = "addition-only" | "in-history";

export type LlmToolSchema = {
  readonly name: string;
  readonly description: string;
  readonly parameters: Record<string, unknown>;
  /** Anthropic / DeepSeek Messages `defer_loading`. */
  readonly deferLoading?: true;
};

export type ProjectedToolDeclarations = {
  readonly tools: readonly LlmToolSchema[];
  /** Names that need a Messages `tool_addition` activation this request. */
  readonly activations: readonly string[];
  /**
   * True when addition-only had to rebuild (caller should
   * `breakToolsBaseline` and re-anchor).
   */
  readonly rebuilt: boolean;
};

function stripDefer(tool: LlmToolSchema): LlmToolSchema {
  if (tool.deferLoading !== true) return tool;
  const { deferLoading: _drop, ...rest } = tool;
  return rest;
}

/**
 * Project standing tools for the active route's `toolUpdate` mode.
 *
 * @param tools - ordered standing schemas (already series-stabilized)
 * @param priorNames - names from the series tools baseline (undefined = first wire)
 * @param toolUpdate - route capability; omit → unsupported
 */
export function projectToolDeclarations(input: {
  readonly tools: readonly LlmToolSchema[];
  readonly priorNames?: readonly string[];
  readonly toolUpdate?: ToolUpdate;
}): ProjectedToolDeclarations {
  const { tools, toolUpdate } = input;
  if (!toolUpdate) {
    return {
      tools: tools.map(stripDefer),
      activations: [],
      rebuilt: false,
    };
  }

  const prior = input.priorNames ?? [];
  const priorSet = new Set(prior);
  const currentNames = new Set(tools.map((t) => t.name));
  const removed = prior.filter((n) => !currentNames.has(n));

  // First wire of a series, or addition-only after a removal → full immediate set.
  if (prior.length === 0 || (toolUpdate === "addition-only" && removed.length > 0)) {
    return {
      tools: tools.map(stripDefer),
      activations: [],
      rebuilt: removed.length > 0,
    };
  }

  const activations: string[] = [];
  const projected: LlmToolSchema[] = tools.map((t) => {
    if (priorSet.has(t.name)) return stripDefer(t);
    activations.push(t.name);
    return { ...stripDefer(t), deferLoading: true as const };
  });

  // in-history also activates additions the same way; removals keep declarations
  // (DSH) — we already dropped removed names from `tools`, so nothing to retain.
  return { tools: projected, activations, rebuilt: false };
}

/** Protocols that can emit `defer_loading` + mid-convo `tool_addition`. */
export function protocolSupportsToolUpdate(
  protocol: string | undefined,
): boolean {
  return protocol === "anthropic-messages";
}
