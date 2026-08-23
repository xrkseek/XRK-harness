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
  /** Slash command contributions → Face `commands/list` + `commands/execute` */
  commands: "commands",
  /**
   * Same-origin public HTTP routes before SPA fallback (DSH `ctx.webServer.register`
   * analogue — no Cordis `apply()`).
   */
  host: "host",
} as const;

export type KnownPluginKind =
  (typeof PLUGIN_KINDS)[keyof typeof PLUGIN_KINDS];

/** Reserved / discovered but not auto-wired yet. */
export const RESERVED_PLUGIN_KINDS = [
  "channel",
  "policy",
  "llm",
  /** DSH Cordis host package: listed, never `import()` / `apply()`. */
  "cordis",
] as const;

export function isKnownPluginKind(kind: string): kind is KnownPluginKind {
  return (Object.values(PLUGIN_KINDS) as string[]).includes(kind);
}
