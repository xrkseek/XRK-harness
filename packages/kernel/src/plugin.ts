import type { Context } from "./context.js";
import { pluginId, type PluginId } from "./types.js";

export interface Plugin {
  readonly id: PluginId;
  setup(ctx: Context): void | Promise<void>;
  teardown?(ctx: Context): void | Promise<void>;
}

export interface DefinePluginInput {
  id: string;
  setup: (ctx: Context) => void | Promise<void>;
  teardown?: (ctx: Context) => void | Promise<void>;
}

export function definePlugin(input: DefinePluginInput): Plugin {
  const id = pluginId(input.id);
  return {
    id,
    setup: input.setup,
    ...(input.teardown ? { teardown: input.teardown } : {}),
  };
}
