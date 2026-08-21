/**
 * Step-local tool settlement: serial, or concurrency-aware parallel.
 *
 * When `mode` is `parallel` (default):
 *   - only tools whose `isConcurrencySafe(args) === true` may overlap
 *   - exclusive calls are barriers (drain pool, run alone)
 *   - later calls are reclassified before start (registry hot-reload safe)
 *
 * Innovation vs OpenCode FiberSet (completion-order publish):
 *   1) append every tool/call (barrier — caller)
 *   2) settle bodies with exclusive barriers + bounded parallel pools
 *   3) append tool/result in **call order** (caller)
 * so the durable log stays reconstructible and order-stable.
 *
 * Cancel (DSH): already-started calls finish or `ABORTED`; never-started calls
 * receive synthetic `ABORTED_BEFORE_DISPATCH` outcomes — no throw mid-batch.
 */

import {
  TOOL_ABORTED,
  TOOL_ABORTED_BEFORE_DISPATCH,
  TOOL_ABORTED_BEFORE_DISPATCH_MESSAGE,
  type ToolCall,
} from "@xrkseek/protocol";
import {
  abortedToolContent,
  classifyToolExecutionMode,
  isAbortError,
  runToolDetailed,
  type RunToolOutcome,
  type ToolMaterialization,
  type ToolPipeline,
  type ToolRegistry,
} from "@xrkseek/core-tools";

export type ToolSettleMode = "serial" | "parallel";

export interface SettleToolBatchInput {
  readonly calls: readonly ToolCall[];
  readonly registry: ToolRegistry;
  readonly materialization: ToolMaterialization;
  readonly pipeline?: ToolPipeline;
  readonly signal?: AbortSignal;
  /** Default `parallel` (concurrency-classified). Use `serial` to force exclusive. */
  readonly mode?: ToolSettleMode;
  /**
   * Cap concurrent settles within a parallel group.
   * Omit / ≤0 → unbounded within the group. Face `agent-loop.maxParallelToolCalls`.
   */
  readonly maxParallel?: number;
}

export interface SettleToolBatchResult {
  readonly outcomes: readonly RunToolOutcome[];
  readonly mode: ToolSettleMode;
  /** True when cancel filled remaining slots with ABORTED_BEFORE_DISPATCH. */
  readonly aborted: boolean;
}

const EMPTY_SIDE: Pick<
  RunToolOutcome,
  "additionalContexts" | "safetyNotices" | "toolEvents" | "stages"
> = {
  additionalContexts: [],
  safetyNotices: [],
  toolEvents: [],
  stages: [],
};

function abortedBeforeDispatchOutcome(call: ToolCall): RunToolOutcome {
  return {
    result: {
      toolCallId: call.id,
      name: call.name,
      content: TOOL_ABORTED_BEFORE_DISPATCH_MESSAGE,
      isError: true,
      error: {
        name: "AbortError",
        code: TOOL_ABORTED_BEFORE_DISPATCH,
      },
    },
    ...EMPTY_SIDE,
    skippedBody: true,
  };
}

/** Fallback when AbortError escapes runTool (pipeline normally absorbs it). */
function abortedAfterStartOutcome(call: ToolCall): RunToolOutcome {
  const body = abortedToolContent();
  return {
    result: {
      toolCallId: call.id,
      name: call.name,
      content: body.content,
      isError: true,
      ...(body.error !== undefined ? { error: body.error } : {}),
    },
    ...EMPTY_SIDE,
    skippedBody: false,
  };
}

function isAbortSettlementCode(code: string | undefined): boolean {
  return code === TOOL_ABORTED || code === TOOL_ABORTED_BEFORE_DISPATCH;
}

async function settleOne(
  input: SettleToolBatchInput,
  call: ToolCall,
): Promise<RunToolOutcome> {
  if (input.signal?.aborted) {
    return abortedBeforeDispatchOutcome(call);
  }
  return runToolDetailed({
    registry: input.registry,
    call,
    materialization: input.materialization,
    ...(input.signal ? { signal: input.signal } : {}),
    ...(input.pipeline ? { pipeline: input.pipeline } : {}),
  });
}

function parallelCap(input: SettleToolBatchInput): number {
  if (
    typeof input.maxParallel === "number" &&
    Number.isFinite(input.maxParallel) &&
    input.maxParallel > 0
  ) {
    return Math.floor(input.maxParallel);
  }
  return Number.POSITIVE_INFINITY;
}

/**
 * Run a consecutive parallel-classified group with a rolling pool.
 * Stops filling when a later call reclassifies as exclusive (left for next group).
 */
async function settleParallelGroup(
  input: SettleToolBatchInput,
  group: readonly ToolCall[],
): Promise<{
  readonly outcomes: RunToolOutcome[];
  readonly consumed: number;
  readonly aborted: boolean;
}> {
  const cap = parallelCap(input);
  const outcomes: (RunToolOutcome | undefined)[] = group.map(() => undefined);
  const inFlight = new Map<number, Promise<number>>();
  let nextToStart = 0;
  let started = 0;
  let failure: unknown;
  let aborted = false;

  const start = (index: number): void => {
    const call = group[index]!;
    started += 1;
    const promise = settleOne(input, call).then(
      (outcome) => {
        outcomes[index] = outcome;
        if (isAbortSettlementCode(outcome.result.error?.code)) {
          aborted = true;
        }
        return index;
      },
      (err: unknown) => {
        if (isAbortError(err)) {
          aborted = true;
          outcomes[index] = abortedAfterStartOutcome(call);
          return index;
        }
        failure ??= err;
        return index;
      },
    );
    inFlight.set(index, promise);
  };

  const fill = (): void => {
    while (
      nextToStart < group.length &&
      inFlight.size < cap &&
      !input.signal?.aborted &&
      !aborted
    ) {
      const call = group[nextToStart]!;
      if (
        nextToStart > 0 &&
        classifyToolExecutionMode(input.registry, call).kind !== "parallel"
      ) {
        break;
      }
      start(nextToStart);
      nextToStart += 1;
    }
  };

  fill();
  while (inFlight.size > 0) {
    const settledIndex = await Promise.race(inFlight.values());
    inFlight.delete(settledIndex);
    if (failure !== undefined) {
      await Promise.allSettled([...inFlight.values()]);
      throw failure;
    }
    if (input.signal?.aborted) {
      aborted = true;
      await Promise.allSettled([...inFlight.values()]);
      break;
    }
    fill();
  }

  if (aborted || input.signal?.aborted) {
    aborted = true;
    for (let i = 0; i < group.length; i++) {
      if (outcomes[i] === undefined) {
        outcomes[i] = abortedBeforeDispatchOutcome(group[i]!);
      }
    }
    return {
      outcomes: outcomes as RunToolOutcome[],
      consumed: group.length,
      aborted: true,
    };
  }

  const settled: RunToolOutcome[] = [];
  for (let i = 0; i < started; i++) {
    const o = outcomes[i];
    if (o === undefined) {
      throw new Error(`settleToolBatch: missing outcome at ${i}`);
    }
    settled.push(o);
  }
  return { outcomes: settled, consumed: started, aborted: false };
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
    return { outcomes: [], mode, aborted: false };
  }

  if (mode === "serial") {
    const outcomes: RunToolOutcome[] = [];
    let aborted = false;
    for (const call of input.calls) {
      if (aborted || input.signal?.aborted) {
        aborted = true;
        outcomes.push(abortedBeforeDispatchOutcome(call));
        continue;
      }
      const outcome = await settleOne(input, call);
      if (isAbortSettlementCode(outcome.result.error?.code)) {
        aborted = true;
      }
      outcomes.push(outcome);
    }
    return { outcomes, mode, aborted };
  }

  const outcomes: RunToolOutcome[] = [];
  let next = 0;
  let aborted = false;
  while (next < input.calls.length) {
    if (aborted || input.signal?.aborted) {
      aborted = true;
      for (let i = next; i < input.calls.length; i++) {
        outcomes.push(abortedBeforeDispatchOutcome(input.calls[i]!));
      }
      break;
    }
    const first = input.calls[next]!;
    const kind = classifyToolExecutionMode(input.registry, first).kind;
    if (kind === "exclusive") {
      const outcome = await settleOne(input, first);
      if (isAbortSettlementCode(outcome.result.error?.code)) {
        aborted = true;
      }
      outcomes.push(outcome);
      next += 1;
      continue;
    }
    const group = input.calls.slice(next);
    const {
      outcomes: groupOut,
      consumed,
      aborted: groupAborted,
    } = await settleParallelGroup(input, group);
    outcomes.push(...groupOut);
    next += consumed;
    if (groupAborted) aborted = true;
  }

  return { outcomes, mode, aborted };
}
