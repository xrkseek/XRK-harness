/**
 * Process-plugin contribution kinds (Host / presets wire these).
 * Kernel `definePlugin` remains the in-process DI/event plugin model.
 *
 * Discipline: new capability surface → prefer a kind + apply* wire,
 * not a one-off Host special case.
 */

export const PLUGIN_KINDS = {
  /** ToolDefinition contributions → ToolRegistry */
  tools: "tools",
  /** System prompt sections → SystemPromptAssembler */
  prompt: "prompt",
} as const;

export type KnownPluginKind =
  (typeof PLUGIN_KINDS)[keyof typeof PLUGIN_KINDS];

/** Reserved / discovered but not auto-wired yet. */
export const RESERVED_PLUGIN_KINDS = [
  "channel",
  "policy",
  "llm",
] as const;

export function isKnownPluginKind(kind: string): kind is KnownPluginKind {
  return (Object.values(PLUGIN_KINDS) as string[]).includes(kind);
}
