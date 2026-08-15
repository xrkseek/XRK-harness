/**
 * Repeated identical tool-call detection (pure).
 * @see docs/learn/cline-mistake-loop-safety.md
 */

export interface LoopDetectionState {
  lastToolName: string;
  lastToolSignature: string;
  consecutiveIdenticalCount: number;
}

export interface LoopDetectionConfig {
  readonly softThreshold: number;
  readonly hardThreshold: number;
}

export const DEFAULT_LOOP_CONFIG: LoopDetectionConfig = {
  softThreshold: 3,
  hardThreshold: 5,
};

export type LoopVerdictKind = "ok" | "soft" | "hard";

export interface LoopVerdict {
  readonly kind: LoopVerdictKind;
  readonly count: number;
  readonly toolName: string;
  readonly signature: string;
}

function sortKeys(value: unknown): unknown {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(sortKeys);
  const obj = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(obj).sort()) {
    out[key] = sortKeys(obj[key]);
  }
  return out;
}

/** Canonical signature for tool args (key-order independent). */
export function toolCallSignature(input: unknown): string {
  if (input === null) return "null";
  if (input === undefined) return "undefined";
  const t = typeof input;
  if (t === "string" || t === "number" || t === "boolean" || t === "bigint") {
    return String(input);
  }
  try {
    return JSON.stringify(sortKeys(input));
  } catch {
    return String(input);
  }
}

export function emptyLoopState(): LoopDetectionState {
  return {
    lastToolName: "",
    lastToolSignature: "",
    consecutiveIdenticalCount: 0,
  };
}

/**
 * Advance state for one tool call. Soft fires only when count === softThreshold.
 */
export function checkRepeatedToolCall(
  state: LoopDetectionState,
  toolName: string,
  input: unknown,
  config: LoopDetectionConfig = DEFAULT_LOOP_CONFIG,
): { readonly next: LoopDetectionState; readonly verdict: LoopVerdict } {
  const signature = toolCallSignature(input);
  const same =
    toolName === state.lastToolName && signature === state.lastToolSignature;
  const count = same ? state.consecutiveIdenticalCount + 1 : 1;
  const next: LoopDetectionState = {
    lastToolName: toolName,
    lastToolSignature: signature,
    consecutiveIdenticalCount: count,
  };
  let kind: LoopVerdictKind = "ok";
  if (count >= config.hardThreshold) kind = "hard";
  else if (count === config.softThreshold) kind = "soft";
  return {
    next,
    verdict: { kind, count, toolName, signature },
  };
}

export function createLoopDetectionTracker(
  config: Partial<LoopDetectionConfig> | false = {},
) {
  if (config === false) {
    return {
      enabled: false as const,
      inspect(): LoopVerdict {
        return { kind: "ok", count: 0, toolName: "", signature: "" };
      },
      reset() {},
      snapshot: () => emptyLoopState(),
    };
  }
  const cfg: LoopDetectionConfig = {
    softThreshold: config.softThreshold ?? DEFAULT_LOOP_CONFIG.softThreshold,
    hardThreshold: config.hardThreshold ?? DEFAULT_LOOP_CONFIG.hardThreshold,
  };
  let state = emptyLoopState();
  return {
    enabled: true as const,
    inspect(toolName: string, input: unknown): LoopVerdict {
      const { next, verdict } = checkRepeatedToolCall(state, toolName, input, cfg);
      state = next;
      return verdict;
    },
    reset() {
      state = emptyLoopState();
    },
    snapshot: () => ({ ...state }),
  };
}

export type LoopDetectionTracker = ReturnType<typeof createLoopDetectionTracker>;

export function softLoopNotice(verdict: LoopVerdict): string {
  return (
    `[system] Repeated identical tool call detected (${verdict.toolName} ×${verdict.count}). ` +
    `Try a different approach or arguments instead of repeating the same call.`
  );
}

export function hardLoopNotice(verdict: LoopVerdict): string {
  return (
    `[system] Tool loop hard limit: ${verdict.toolName} repeated ${verdict.count} times with the same arguments. ` +
    `Stopping this turn. Session is kept — send a new message to continue.`
  );
}
