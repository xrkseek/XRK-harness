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
import {
  renderPromptSections,
  PROMPT_VARIABLE_NAME,
  type PromptVarSection,
} from "./prompt-vars.js";

export {
  assembleThreeLayers,
  buildSkeletonSystem,
  buildSkeletonUser,
  buildVolatileBlock,
  buildVolatileUser,
  mergeHistory,
  hasHumanUserText,
  hasHumanMessageContent,
  isMetadataOnlyUserMessage,
  stripVolatileBlock,
  textOfContent,
  CURRENT_MESSAGE_LABEL,
  VOLATILE_OPEN,
  VOLATILE_CLOSE,
  orderToolsForWire,
  TOOL_ORDER_REST,
  type AssembledRequest,
  type SkeletonSystemInput,
  type SkeletonUserInput,
  type ThreeLayerInput,
  type VolatileUserInput,
} from "./three-layer.js";

export {
  shouldRefreshTimeContext,
  clearTimeContextRefreshState,
  noteTimeContextInjected,
  parseTimeContextRefreshMs,
} from "./time-context.js";

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

export {
  interpolatePromptText,
  renderPromptSections,
  PROMPT_VARIABLE_NAME,
  type PromptVarSection,
} from "./prompt-vars.js";

export interface PromptSection {
  readonly id: string;
  readonly order?: number;
  /**
   * When false, keep `{{…}}` literally after assemble (tool schema / PTC SDK
   * docs). Default true — other sections interpolate registered variables.
   */
  readonly interpolate?: boolean;
  content(): string | Promise<string>;
}

export interface SystemPromptAssembler {
  register(section: PromptSection): void;
  /** Register a `{{name}}` value used when assembling interpolating sections. */
  variable(name: string, value: string | (() => string)): void;
  assemble(): Promise<string>;
}

export function createSystemPromptAssembler(): SystemPromptAssembler {
  const sections: PromptSection[] = [];
  const variables = new Map<string, string | (() => string)>();
  return {
    register(section) {
      if (sections.some((s) => s.id === section.id)) {
        throw new Error(`prompt section already registered: ${section.id}`);
      }
      sections.push(section);
    },
    variable(name, value) {
      if (!PROMPT_VARIABLE_NAME.test(name)) {
        throw new Error(
          `invalid prompt variable name "${name}" (must match ${String(PROMPT_VARIABLE_NAME)})`,
        );
      }
      if (variables.has(name)) {
        throw new Error(`prompt variable already registered: ${name}`);
      }
      variables.set(name, value);
    },
    async assemble() {
      const sorted = [...sections].sort(
        (a, b) => (a.order ?? 0) - (b.order ?? 0),
      );
      const resolved: Record<string, string | undefined> = {};
      for (const [name, provider] of variables) {
        resolved[name] = typeof provider === "function" ? provider() : provider;
      }
      const rendered: PromptVarSection[] = [];
      for (const s of sorted) {
        const text = await s.content();
        if (!text.trim()) continue;
        rendered.push({
          name: s.id,
          text,
          ...(s.interpolate === false ? { interpolate: false as const } : {}),
        });
      }
      return renderPromptSections(rendered, resolved);
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
