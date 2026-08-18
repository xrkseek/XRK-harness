import type { ToolDefinition } from "@xrkseek/core-tools";

/** Prompt section contribution (`kind: "prompt"`). */
export interface PluginPromptSection {
  readonly id: string;
  readonly order?: number;
  readonly content: string | (() => string | Promise<string>);
}

/** Slash command contribution (`kind: "commands"`). */
export interface PluginCommandResult {
  readonly kind: "success" | "error";
  readonly text?: string;
}

export interface PluginCommandContext {
  readonly sessionId: string;
  readonly rawInput: string;
  readonly commandId: string;
}

export interface PluginCommand {
  readonly name: string;
  readonly description: string;
  readonly input?: { readonly hint: string };
  readonly handler: (
    ctx: PluginCommandContext,
  ) => PluginCommandResult | Promise<PluginCommandResult>;
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
  /**
   * When `kind === "commands"`: slash contributions for Face `commands/*`.
   * Collected via `collectPluginCommands` — first name wins.
   */
  readonly commands?: readonly PluginCommand[];
  dispose?: () => void | Promise<void>;
}
