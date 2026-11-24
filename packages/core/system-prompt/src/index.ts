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
  stabilizeToolsForSeries,
  TOOL_ORDER_REST,
  type AssembledRequest,
  type ToolsWireBaseline,
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
