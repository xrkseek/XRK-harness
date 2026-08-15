import type { ToolCall, ToolResult } from "@xrkseek/protocol";
import type { ToolRegistry } from "./definition.js";
import type { ToolMaterialization } from "./materialize.js";
import { createToolPipeline, runToolPipeline } from "./pipeline.js";
import type { RunToolOutcome, ToolPipeline } from "./types.js";

export interface RunToolInput {
  readonly registry: ToolRegistry;
  readonly call: ToolCall;
  readonly signal?: AbortSignal;
  readonly pipeline?: ToolPipeline;
  readonly timeoutMs?: number;
  readonly maxRetries?: number;
  /** When set, settle via step snapshot (stale/unknown) instead of live get(). */
  readonly materialization?: ToolMaterialization;
}

function isRunToolInput(
  value: ToolRegistry | RunToolInput,
): value is RunToolInput {
  return (
    typeof value === "object" &&
    value !== null &&
    "registry" in value &&
    "call" in value
  );
}

/**
 * Full waterfall entry. Caller must append `tool/call` to the session
 * **before** invoking this (see agent-loop).
 */
export async function runTool(
  registryOrInput: ToolRegistry | RunToolInput,
  call?: ToolCall,
  signal?: AbortSignal,
): Promise<ToolResult> {
  const outcome = await runToolDetailed(registryOrInput, call, signal);
  return outcome.result;
}

export async function runToolDetailed(
  registryOrInput: ToolRegistry | RunToolInput,
  call?: ToolCall,
  signal?: AbortSignal,
): Promise<RunToolOutcome> {
  const input: RunToolInput = isRunToolInput(registryOrInput)
    ? registryOrInput
    : {
        registry: registryOrInput,
        call: call!,
        ...(signal ? { signal } : {}),
      };

  if (input.materialization) {
    return input.materialization.settle({
      call: input.call,
      ...(input.signal ? { signal: input.signal } : {}),
      ...(input.pipeline ? { pipeline: input.pipeline } : {}),
      ...(input.timeoutMs !== undefined ? { timeoutMs: input.timeoutMs } : {}),
      ...(input.maxRetries !== undefined
        ? { maxRetries: input.maxRetries }
        : {}),
    });
  }

  const tool = input.registry.get(input.call.name);
  return runToolPipeline(tool, input.call, input.signal, input.pipeline, {
    ...(input.timeoutMs !== undefined ? { timeoutMs: input.timeoutMs } : {}),
    ...(input.maxRetries !== undefined ? { maxRetries: input.maxRetries } : {}),
  });
}

export { createToolPipeline };
