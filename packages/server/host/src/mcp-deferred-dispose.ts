/**
 * Soft-detach MCP plugins while a session drain still holds mid-turn tool
 * handles. Hard `unregister` (dispose) runs once drains are idle — pairs with
 * Host agent-cache mid-drain skip so settings_mutate remount does not kill
 * an in-flight MCP tool call.
 */

import type { RegisteredPlugin } from "@xrkseek/server-loader";

export interface McpDeferredDispose {
  /** Soft-detached plugins still serving in-flight tools. */
  retained(): readonly RegisteredPlugin[];
  /** Soft-detach when busy; otherwise hard unregister+dispose. */
  remove(id: string): Promise<void>;
  /** Dispose every retained plugin once `isBusy` is false. */
  flush(): Promise<void>;
}

export function createMcpDeferredDispose(options: {
  readonly detach: (id: string) => RegisteredPlugin | undefined;
  readonly unregister: (id: string) => Promise<void>;
  /** True while any drain is active or pending agent invalidate remains. */
  readonly isBusy: () => boolean;
}): McpDeferredDispose {
  const zombies: RegisteredPlugin[] = [];

  return {
    retained() {
      return zombies;
    },

    async remove(id) {
      if (options.isBusy()) {
        const detached = options.detach(id);
        if (detached) zombies.push(detached);
        return;
      }
      await options.unregister(id);
    },

    async flush() {
      if (options.isBusy()) return;
      const batch = zombies.splice(0, zombies.length);
      for (const plugin of batch) {
        try {
          await plugin.dispose?.();
        } catch {
          /* best-effort teardown */
        }
      }
    },
  };
}
