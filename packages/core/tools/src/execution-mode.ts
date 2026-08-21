/**
 * Fail-closed tool concurrency classification (DSH executionMode).
 */
import type { ToolCall } from "@xrkseek/protocol";
import type { ToolRegistry } from "./definition.js";

export type ToolExecutionModeKind = "parallel" | "exclusive";

export interface ToolExecutionMode {
  readonly kind: ToolExecutionModeKind;
}

/**
 * Classify one pending call. Only exact `true` from a registered tool's
 * `isConcurrencySafe` is parallel; unknown / missing / throw → exclusive.
 */
export function classifyToolExecutionMode(
  registry: ToolRegistry,
  call: ToolCall,
): ToolExecutionMode {
  const tool = registry.get(call.name);
  if (!tool?.isConcurrencySafe) return { kind: "exclusive" };
  try {
    const safe: unknown = tool.isConcurrencySafe(call.arguments as never);
    return safe === true ? { kind: "parallel" } : { kind: "exclusive" };
  } catch {
    return { kind: "exclusive" };
  }
}
