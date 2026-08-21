import type { ChatMessage, SessionEvent } from "@xrkseek/protocol";
import {
  assertModelVisible,
  deriveMessages,
} from "@xrkseek/core-session";
import {
  assembleThreeLayers,
  type ThreeLayerInput,
} from "./three-layer.js";
import {
  compactionStep,
  createAssembleStep,
  createContextWindowStep,
  createOutboundPipeline,
  createSlashRecipeStep,
  createToolPairStep,
  slashRecipeStep,
  type PipelineStep,
  type SlashResolveFn,
} from "./outbound.js";

export {
  assembleThreeLayers,
  buildSkeletonSystem,
  buildSkeletonUser,
  buildVolatileUser,
  mergeHistory,
  orderToolsForWire,
  TOOL_ORDER_REST,
  type AssembledRequest,
  type SkeletonSystemInput,
  type SkeletonUserInput,
  type ThreeLayerInput,
  type VolatileUserInput,
} from "./three-layer.js";

export {
  compactionStep,
  createAssembleStep,
  createContextWindowStep,
  createOutboundPipeline,
  createSlashRecipeStep,
  createToolPairStep,
  slashRecipeStep,
  type OutboundPipeline,
  type PipelineStep,
  type PipelineStepContext,
  type SlashExpandResult,
  type SlashResolveFn,
} from "./outbound.js";

export interface PromptSection {
  readonly id: string;
  readonly order?: number;
  content(): string | Promise<string>;
}

export interface SystemPromptAssembler {
  register(section: PromptSection): void;
  assemble(): Promise<string>;
}

export function createSystemPromptAssembler(): SystemPromptAssembler {
  const sections: PromptSection[] = [];
  return {
    register(section) {
      if (sections.some((s) => s.id === section.id)) {
        throw new Error(`prompt section already registered: ${section.id}`);
      }
      sections.push(section);
    },
    async assemble() {
      const sorted = [...sections].sort(
        (a, b) => (a.order ?? 0) - (b.order ?? 0),
      );
      const parts: string[] = [];
      for (const s of sorted) {
        const text = await s.content();
        if (text.trim()) parts.push(text);
      }
      return parts.join("\n\n");
    },
  };
}

/**
 * Default outbound chain:
 * slash → assemble → toolPair → compaction → contextWindow → invariant
 *
 * Prefer `assemble.resolveSlash` on `runTurn` for the hot path.
 * Pass `resolveSlash` here only when driving the outbound pipeline directly.
 */
export function createDefaultOutbound(options: {
  buildInput: () => ThreeLayerInput | Promise<ThreeLayerInput>;
  events: readonly SessionEvent[];
  maxMessages?: number;
  extraSteps?: readonly PipelineStep[];
  resolveSlash?: SlashResolveFn;
}) {
  const pipeline = createOutboundPipeline();
  pipeline.use(
    options.resolveSlash
      ? createSlashRecipeStep(options.resolveSlash)
      : slashRecipeStep,
  );
  pipeline.use(
    createAssembleStep(async () => assembleThreeLayers(await options.buildInput())),
  );
  pipeline.use(createToolPairStep());
  pipeline.use(compactionStep);
  pipeline.use(createContextWindowStep(options.maxMessages ?? 200));
  for (const step of options.extraSteps ?? []) {
    pipeline.use(step);
  }
  pipeline.use(async (ctx, next) => {
    // System is separate; invariant checks history-derived messages only
    // against the non-system portion when we strip volatile+skeleton differently.
    // M1: assert that deriveMessages(events) matches provided history snapshot
    // carried in meta, else compare events to themselves via derive.
    const history = (ctx.meta.historyForInvariant as ChatMessage[] | undefined) ??
      deriveMessages(options.events);
    assertModelVisible(options.events, history);
    await next();
  });
  return pipeline;
}
