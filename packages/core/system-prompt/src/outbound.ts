import type { ChatMessage } from "@xrkseek/protocol";
import { assertAssistantToolCallAdjacency } from "@xrkseek/core-session";
import type { AssembledRequest } from "./three-layer.js";

export interface PipelineStepContext {
  request: AssembledRequest;
  readonly history: readonly ChatMessage[];
  readonly meta: Record<string, unknown>;
}

export type PipelineStep = (
  ctx: PipelineStepContext,
  next: () => Promise<void>,
) => Promise<void>;

export interface OutboundPipeline {
  use(step: PipelineStep): OutboundPipeline;
  run(initial: PipelineStepContext): Promise<AssembledRequest>;
}

export function createOutboundPipeline(): OutboundPipeline {
  const steps: PipelineStep[] = [];
  return {
    use(step) {
      steps.push(step);
      return this;
    },
    async run(initial) {
      const ctx: PipelineStepContext = {
        request: initial.request,
        history: initial.history,
        meta: { ...initial.meta },
      };
      let i = -1;
      const dispatch = async (): Promise<void> => {
        i += 1;
        if (i >= steps.length) return;
        await steps[i]!(ctx, dispatch);
      };
      await dispatch();
      return ctx.request;
    },
  };
}

/** Compaction hook — windowing is owned by `deriveMessages` + `runCompaction`. */
export const compactionStep: PipelineStep = async (_ctx, next) => {
  await next();
};

/** Result of expanding `/recipe-id …` into model-visible text. */
export type SlashExpandResult = {
  userPrompt: string;
  systemExtra?: string;
  recipeId?: string;
};

export type SlashResolveFn = (
  raw: string,
) =>
  | SlashExpandResult
  | undefined
  | Promise<SlashExpandResult | undefined>;

/**
 * Slash/recipe preprocess for outbound pipelines.
 * Reads raw text from `meta.rawUserText`, writes expand into `meta.slashExpand`.
 * Prefer `AssembleOptions.resolveSlash` on the `runTurn` hot path.
 */
export function createSlashRecipeStep(resolve: SlashResolveFn): PipelineStep {
  return async (ctx, next) => {
    const raw = ctx.meta.rawUserText;
    if (typeof raw === "string") {
      const hit = await resolve(raw);
      if (hit) {
        ctx.meta.slashExpand = hit;
        ctx.meta.rawUserText = hit.userPrompt;
      }
    }
    await next();
  };
}

/** @deprecated No-op placeholder — use `createSlashRecipeStep` or `assemble.resolveSlash`. */
export const slashRecipeStep: PipelineStep = async (_ctx, next) => {
  await next();
};

export function createAssembleStep(
  assemble: () => AssembledRequest | Promise<AssembledRequest>,
): PipelineStep {
  return async (ctx, next) => {
    ctx.request = await assemble();
    await next();
  };
}

/** Ensure assistant tool_calls have matching adjacent tool results in history. */
export function createToolPairStep(): PipelineStep {
  return async (ctx, next) => {
    try {
      assertAssistantToolCallAdjacency(ctx.request.messages);
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      throw new Error(`toolPair validation failed: ${detail}`, { cause: err });
    }
    await next();
  };
}

export function createContextWindowStep(maxMessages: number): PipelineStep {
  return async (ctx, next) => {
    if (ctx.request.messages.length > maxMessages) {
      const trimmed = ctx.request.messages.slice(-maxMessages);
      ctx.request = {
        system: ctx.request.system,
        messages: trimmed,
        tools: ctx.request.tools,
      };
      ctx.meta.contextWindowTrimmed = true;
    }
    await next();
  };
}
