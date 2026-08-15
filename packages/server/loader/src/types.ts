import type { ToolDefinition } from "@xrkseek/core-tools";

export interface RegisteredPlugin {
  readonly id: string;
  readonly kind: string;
  /**
   * When `kind === "tools"`, optional ToolDefinition contributions.
   * Applied via `applyToolsPlugins` — explicit registry names win.
   */
  readonly tools?: readonly ToolDefinition[];
  dispose?: () => void | Promise<void>;
}
