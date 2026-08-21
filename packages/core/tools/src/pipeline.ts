import type { ToolCall } from "@xrkseek/protocol";
import {
  errorToolResult,
  freezeToolResult,
  normalizeToolResult,
  type ToolDefinition,
} from "./definition.js";
import { abortedToolContent, isAbortError } from "./abort.js";
import { runGuards } from "./guards.js";
import {
  boundToolOutput,
  type BoundToolOutputOptions,
} from "./output-bound.js";
import {
  isTransientError,
  type ApprovalHandler,
  type ExecuteAroundHandler,
  type FinalizeHandler,
  type MonotonicGuard,
  type PipelineStage,
  type PostHandler,
  type PreHandler,
  type PreOutcome,
  type RunToolOutcome,
  type ToolPipeline,
  type ToolPipelineContext,
} from "./types.js";

export type ToolPipelineOptions = {
  /**
   * Model-facing output bound after finalize.
   * Default: enabled with 2000 lines / 50KiB. Pass `false` to disable.
   */
  readonly outputBound?: false | BoundToolOutputOptions;
};

function mergeSignals(
  outer: AbortSignal | undefined,
  timeoutMs: number | undefined,
): AbortSignal | undefined {
  const parts: AbortSignal[] = [];
  if (outer) parts.push(outer);
  if (timeoutMs !== undefined && timeoutMs > 0) {
    parts.push(AbortSignal.timeout(timeoutMs));
  }
  if (parts.length === 0) return undefined;
  if (parts.length === 1) return parts[0];
  return AbortSignal.any(parts);
}

async function runPre(
  handlers: readonly PreHandler[],
  ctx: ToolPipelineContext,
  approval: ApprovalHandler | undefined,
): Promise<"continue" | "deny"> {
  for (const handler of handlers) {
    const outcome: PreOutcome = await handler(ctx);
    if (outcome.action === "continue") {
      ctx.args = outcome.args;
      continue;
    }
    if (outcome.action === "deny") {
      ctx.denyReason = outcome.reason;
      return "deny";
    }
    const ok = approval ? await approval(ctx, outcome.reason) : false;
    if (!ok) {
      ctx.denyReason = outcome.reason;
      return "deny";
    }
  }
  return "continue";
}

async function runPost(
  handlers: readonly PostHandler[],
  ctx: ToolPipelineContext,
): Promise<void> {
  for (const handler of handlers) {
    const outcome = await handler(ctx);
    if (outcome.action === "accept") continue;
    if (outcome.action === "block") {
      ctx.result = { content: outcome.reason, isError: true };
      continue;
    }
    ctx.result = {
      content: outcome.content,
      ...(outcome.isError ? { isError: true as const } : {}),
      // Replace drops prior concludesTurn (new content owns the flag).
    };
  }
}

function copyResultFields(
  content: import("@xrkseek/protocol").MessageContent,
  prev: NonNullable<ToolPipelineContext["result"]>,
): NonNullable<ToolPipelineContext["result"]> {
  return {
    content,
    ...(prev.isError ? { isError: true as const } : {}),
    ...(prev.meta !== undefined ? { meta: prev.meta } : {}),
    ...(prev.concludesTurn === true && !prev.isError
      ? { concludesTurn: true as const }
      : {}),
    ...(prev.error !== undefined ? { error: prev.error } : {}),
  };
}

async function runFinalize(
  handlers: readonly FinalizeHandler[],
  ctx: ToolPipelineContext,
): Promise<void> {
  if (!ctx.result) return;
  let content = ctx.result.content;
  for (const handler of handlers) {
    content = await handler(ctx);
  }
  ctx.result = copyResultFields(content, ctx.result);
}

async function executeBody(
  tool: ToolDefinition,
  ctx: ToolPipelineContext,
  around: readonly ExecuteAroundHandler[],
  options: { timeoutMs?: number; maxRetries?: number },
): Promise<void> {
  const maxRetries = options.maxRetries ?? 0;
  let attempt = 0;

  const body = async (): Promise<void> => {
    const signal = mergeSignals(ctx.signal, options.timeoutMs);
    ctx.metrics.calls += 1;
    const out = await tool.execute(ctx.args, signal, {
      emitToolEvent: (type, payload) => emitToolEvent(ctx, type, payload),
    });
    // DSH: cancel after body invocation supersedes a late success.
    if ((signal ?? ctx.signal)?.aborted) {
      ctx.result = abortedToolContent();
      return;
    }
    ctx.result = out;
  };

  const withAround = async (): Promise<void> => {
    let i = -1;
    const dispatch = async (): Promise<void> => {
      i += 1;
      if (i >= around.length) {
        await body();
        return;
      }
      const handler = around[i]!;
      await handler(ctx, dispatch);
    };
    await dispatch();
  };

  for (;;) {
    try {
      await withAround();
      return;
    } catch (err) {
      if (isAbortError(err)) {
        ctx.result = abortedToolContent();
        return;
      }
      if (isTransientError(err) && attempt < maxRetries) {
        attempt += 1;
        ctx.metrics.retries += 1;
        continue;
      }
      const message = err instanceof Error ? err.message : String(err);
      ctx.result = { content: message, isError: true };
      return;
    }
  }
}

export function createToolPipeline(
  options: ToolPipelineOptions = {},
): ToolPipeline {
  const preHandlers: PreHandler[] = [];
  const guards: MonotonicGuard[] = [];
  const executeHandlers: ExecuteAroundHandler[] = [];
  const postHandlers: PostHandler[] = [];
  const finalizeHandlers: FinalizeHandler[] = [];
  let approval: ApprovalHandler | undefined;
  const outputBound =
    options.outputBound === false ? undefined : (options.outputBound ?? {});

  preHandlers.push(async (ctx) => ({ action: "continue", args: ctx.args }));

  const api: ToolPipeline = {
    onPre(handler) {
      preHandlers.push(handler);
      return () => {
        const idx = preHandlers.indexOf(handler);
        if (idx >= 0) preHandlers.splice(idx, 1);
      };
    },
    onGuard(guard) {
      guards.push(guard);
      return () => {
        const idx = guards.indexOf(guard);
        if (idx >= 0) guards.splice(idx, 1);
      };
    },
    onExecute(handler) {
      executeHandlers.push(handler);
      return () => {
        const idx = executeHandlers.indexOf(handler);
        if (idx >= 0) executeHandlers.splice(idx, 1);
      };
    },
    onPost(handler) {
      postHandlers.push(handler);
      return () => {
        const idx = postHandlers.indexOf(handler);
        if (idx >= 0) postHandlers.splice(idx, 1);
      };
    },
    onFinalize(handler) {
      finalizeHandlers.push(handler);
      return () => {
        const idx = finalizeHandlers.indexOf(handler);
        if (idx >= 0) finalizeHandlers.splice(idx, 1);
      };
    },
    setApprovalHandler(handler) {
      approval = handler;
    },

    async run(tool, call, signal, runOptions): Promise<RunToolOutcome> {
      const stages: PipelineStage[] = [];
      const ctx: ToolPipelineContext = {
        call,
        args: call.arguments,
        ...(signal ? { signal } : {}),
        stage: "pre",
        skippedBody: false,
        additionalContexts: [],
        safetyNotices: [],
        metrics: { calls: 0, retries: 0 },
        toolEvents: [],
      };

      stages.push("pre");
      ctx.stage = "pre";
      const preDecision = await runPre(preHandlers, ctx, approval);
      if (preDecision === "deny") {
        ctx.skippedBody = true;
        ctx.result = {
          content: ctx.denyReason ?? "denied by pre-execute",
          isError: true,
        };
      } else {
        stages.push("guards");
        ctx.stage = "guards";
        const verdict = await runGuards(guards, ctx);
        if (verdict === "deny") {
          ctx.skippedBody = true;
          ctx.denyReason = ctx.denyReason ?? "denied by guard";
          ctx.result = {
            content: ctx.denyReason,
            isError: true,
          };
        } else if (!tool) {
          ctx.skippedBody = true;
          ctx.result = {
            content: `unknown tool: ${call.name}`,
            isError: true,
          };
        } else {
          stages.push("execute");
          ctx.stage = "execute";
          await executeBody(tool, ctx, executeHandlers, runOptions);
        }
      }

      stages.push("post");
      ctx.stage = "post";
      await runPost(postHandlers, ctx);

      stages.push("finalize");
      ctx.stage = "finalize";
      await runFinalize(finalizeHandlers, ctx);

      let truncated = false;
      let outputPaths: readonly string[] = [];
      if (outputBound && ctx.result) {
        stages.push("bound");
        ctx.stage = "bound";
        const bounded = await boundToolOutput(ctx.result.content, outputBound);
        ctx.result = copyResultFields(bounded.content, ctx.result);
        truncated = bounded.truncated;
        outputPaths = bounded.outputPaths;
      }

      stages.push("result");
      ctx.stage = "result";
      const raw = ctx.result ?? {
        content: "empty tool result",
        isError: true,
      };
      const result = freezeToolResult(
        normalizeToolResult(call.id, call.name, raw),
      );
      // Failures never conclude (DSH ToolExecutionFailure.concludesTurn: never).
      const concludesTurn =
        raw.concludesTurn === true && raw.isError !== true
          ? (true as const)
          : undefined;

      return {
        result,
        additionalContexts: [...ctx.additionalContexts],
        safetyNotices: [...ctx.safetyNotices],
        toolEvents: [...ctx.toolEvents],
        stages,
        skippedBody: ctx.skippedBody,
        ...(truncated ? { truncated: true } : {}),
        ...(outputPaths.length ? { outputPaths } : {}),
        ...(concludesTurn ? { concludesTurn } : {}),
      };
    },
  };

  return api;
}

/** Convenience: run with optional pipeline (defaults to identity + output bound). */
export async function runToolPipeline(
  tool: ToolDefinition | undefined,
  call: ToolCall,
  signal: AbortSignal | undefined,
  pipeline: ToolPipeline | undefined,
  options: { timeoutMs?: number; maxRetries?: number } = {},
): Promise<RunToolOutcome> {
  const pipe = pipeline ?? createToolPipeline();
  return pipe.run(tool, call, signal, options);
}

export function addAdditionalContext(
  ctx: ToolPipelineContext,
  text: string,
): void {
  ctx.additionalContexts.push(text);
}

/** Queue a typed safety notice for session `safety/notice` (batch after results). */
export function addSafetyNotice(
  ctx: ToolPipelineContext,
  notice: import("@xrkseek/protocol").SafetyNoticePayload,
): void {
  ctx.safetyNotices.push(notice);
}

export function emitToolEvent(
  ctx: ToolPipelineContext,
  type: string,
  payload: unknown,
): void {
  ctx.toolEvents.push({ type, payload });
}

export function deniedResult(
  call: ToolCall,
  reason: string,
): ReturnType<typeof freezeToolResult> {
  return freezeToolResult(errorToolResult(call.id, call.name, reason));
}
