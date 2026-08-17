import type { ToolDefinition } from "@xrkseek/core-tools";

/** Prompt section contribution (`kind: "prompt"`). */
export interface PluginPromptSection {
  readonly id: string;
  readonly order?: number;
  readonly content: string | (() => string | Promise<string>);
}

/**
 * Process plugin registered with Host / presets.
 * Prefer a known `kind` + contribution field over Host special cases.
 */
export interface RegisteredPlugin {
  readonly id: string;
  readonly kind: string;
  /**
   * When `kind === "tools"`: ToolDefinition contributions.
   * Applied via `applyToolsPlugins` — explicit registry names win.
   */
  readonly tools?: readonly ToolDefinition[];
  /**
   * When `kind === "prompt"`: system prompt sections.
   * Applied via `applyPromptPlugins` — explicit section ids win.
   */
  readonly promptSections?: readonly PluginPromptSection[];
  dispose?: () => void | Promise<void>;
}
