import type {
  PromptSection,
  SystemPromptAssembler,
} from "@xrkseek/core-system-prompt";
import type { PluginPromptSection, RegisteredPlugin } from "./types.js";
import { PLUGIN_KINDS } from "./kinds.js";

export interface AppliedPluginPrompt {
  readonly pluginId: string;
  readonly sectionId: string;
}

export interface SkippedPluginPrompt extends AppliedPluginPrompt {
  readonly reason: "explicit_wins" | "duplicate_in_batch";
}

export interface ApplyPromptPluginsResult {
  readonly applied: readonly AppliedPluginPrompt[];
  readonly skipped: readonly SkippedPluginPrompt[];
}

export function isPromptPlugin(
  plugin: RegisteredPlugin,
): plugin is RegisteredPlugin & { readonly kind: "prompt" } {
  return plugin.kind === PLUGIN_KINDS.prompt;
}

function toSection(raw: PluginPromptSection): PromptSection {
  const content = raw.content;
  return {
    id: raw.id,
    ...(raw.order !== undefined ? { order: raw.order } : {}),
    content:
      typeof content === "function"
        ? content
        : () => content,
  };
}

/**
 * Register `kind: "prompt"` sections.
 * Explicit assembler ids win (skip, do not replace).
 */
export function applyPromptPlugins(
  assembler: SystemPromptAssembler,
  plugins: readonly RegisteredPlugin[],
  options?: {
    /** Section ids already owned by the host/preset (e.g. "base"). */
    readonly reservedIds?: ReadonlySet<string>;
  },
): ApplyPromptPluginsResult {
  const reserved = options?.reservedIds ?? new Set<string>();
  const applied: AppliedPluginPrompt[] = [];
  const skipped: SkippedPluginPrompt[] = [];
  const seen = new Set<string>(reserved);

  for (const plugin of plugins) {
    if (!isPromptPlugin(plugin)) continue;
    for (const raw of plugin.promptSections ?? []) {
      if (seen.has(raw.id)) {
        skipped.push({
          pluginId: plugin.id,
          sectionId: raw.id,
          reason: reserved.has(raw.id) ? "explicit_wins" : "duplicate_in_batch",
        });
        continue;
      }
      try {
        assembler.register(toSection(raw));
        seen.add(raw.id);
        applied.push({ pluginId: plugin.id, sectionId: raw.id });
      } catch {
        skipped.push({
          pluginId: plugin.id,
          sectionId: raw.id,
          reason: "explicit_wins",
        });
      }
    }
  }

  return { applied, skipped };
}

export function wireCompositionPrompts(
  assembler: SystemPromptAssembler,
  options: {
    readonly plugins?: readonly RegisteredPlugin[];
    readonly reservedIds?: readonly string[];
  } = {},
): ApplyPromptPluginsResult {
  return applyPromptPlugins(assembler, options.plugins ?? [], {
    reservedIds: new Set(options.reservedIds ?? ["base"]),
  });
}
