/**
 * Step-local tool settlement: serial or parallel.
 *
 * Innovation vs OpenCode FiberSet (completion-order publish):
 *   1) append every tool/call (barrier)
 *   2) settle bodies concurrently (optional)
 *   3) append tool/result in **call order**
 * so the durable log stays reconstructible and order-stable.
 */

import {
  runToolDetailed,
  type RunToolOutcome,
  type ToolMaterialization,
  type ToolPipeline,
  type ToolRegistry,
} from "@xrkseek/core-tools";
import type { ToolCall } from "@xrkseek/protocol";

export type ToolSettleMode = "serial" | "parallel";

export interface SettleToolBatchInput {
  readonly calls: readonly ToolCall[];
  readonly registry: ToolRegistry;
  readonly materialization: ToolMaterialization;
  readonly pipeline?: ToolPipeline;
  readonly signal?: AbortSignal;
  /** Default `parallel`. */
  readonly mode?: ToolSettleMode;
  /**
   * Cap concurrent settles when `mode` is `parallel`.
   * Omit / ≤0 → unbounded (Promise.all). Face `agent-loop.maxParallelToolCalls`.
   */
  readonly maxParallel?: number;
}

export interface SettleToolBatchResult {
  readonly outcomes: readonly RunToolOutcome[];
  readonly mode: ToolSettleMode;
}

async function settleOne(
  input: SettleToolBatchInput,
  call: ToolCall,
): Promise<RunToolOutcome> {
  if (input.signal?.aborted) {
    throw new DOMException("aborted", "AbortError");
  }
  return runToolDetailed({
    registry: input.registry,
    call,
    materialization: input.materialization,
    ...(input.signal ? { signal: input.signal } : {}),
    ...(input.pipeline ? { pipeline: input.pipeline } : {}),
  });
}

/**
 * Run settles for already-recorded calls. Does **not** touch the session log —
 * caller owns call/result append barriers.
 */
export async function settleToolBatch(
  input: SettleToolBatchInput,
): Promise<SettleToolBatchResult> {
  const mode = input.mode ?? "parallel";
  if (input.calls.length === 0) {
    return { outcomes: [], mode };
  }

  if (mode === "serial") {
    const outcomes: RunToolOutcome[] = [];
    for (const call of input.calls) {
      outcomes.push(await settleOne(input, call));
    }
    return { outcomes, mode };
  }

  const cap =
    typeof input.maxParallel === "number" &&
    Number.isFinite(input.maxParallel) &&
    input.maxParallel > 0
      ? Math.floor(input.maxParallel)
      : undefined;

  if (cap === undefined || cap >= input.calls.length) {
    const outcomes = await Promise.all(
      input.calls.map((call) => settleOne(input, call)),
    );
    return { outcomes, mode };
  }

  // Bounded parallel: worker pool; results kept in call order.
  const outcomes: RunToolOutcome[] = new Array(input.calls.length);
  let next = 0;
  async function worker(): Promise<void> {
    for (;;) {
      const i = next++;
      if (i >= input.calls.length) return;
      outcomes[i] = await settleOne(input, input.calls[i]!);
    }
  }
  const workers = Array.from({ length: cap }, () => worker());
  await Promise.all(workers);
  return { outcomes, mode };
}
