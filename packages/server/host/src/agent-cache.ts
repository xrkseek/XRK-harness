import type { AgentHandle } from "@xrkseek/core-agent";
import { createRootScope, type Scope } from "@xrkseek/compose";
import type { RegisteredPlugin } from "@xrkseek/server-loader";

/** Realm key: host composition / plugin list snapshot for agent scopes. */
export const HOST_PLUGINS_KEY = "host.plugins";

export interface HostAgentCache {
  readonly hostScope: Scope;
  resolve(
    sessionId: string,
    create: () => Promise<AgentHandle>,
  ): Promise<AgentHandle>;
  /** Drop cached agent with compose Ordering (abort via scope effects). */
  invalidate(sessionId: string): Promise<void>;
  /** Dispose host scope (all agent children first). */
  dispose(): Promise<void>;
}

/**
 * Agent cache backed by `@xrkseek/compose` Scopes.
 * Agents depend on `host.plugins`; invalidate/stop unload consumers before
 * withdrawing the provide (Ordering).
 */
export function createHostAgentCache(
  plugins: readonly RegisteredPlugin[],
  opts?: { hostId?: string },
): HostAgentCache {
  const hostScope = createRootScope({
    id: opts?.hostId ?? "host",
  });
  hostScope.provide(HOST_PLUGINS_KEY, plugins);

  const agents = new Map<string, AgentHandle>();
  const scopes = new Map<string, Scope>();

  return {
    hostScope,

    async resolve(sessionId, create) {
      const existing = agents.get(sessionId);
      if (existing) return existing;

      const child = hostScope.child({
        id: `agent:${sessionId}`,
        depend: [{ name: HOST_PLUGINS_KEY }],
      });
      scopes.set(sessionId, child);

      await child.activate(async () => {
        // Touch inject so consumer edge is live for Ordering on host dispose.
        child.inject(HOST_PLUGINS_KEY);
        const agent = await create();
        child.effect(
          () => () => {
            agent.abort();
          },
          { label: `agent.abort(${sessionId})` },
        );
        agents.set(sessionId, agent);
      });

      const agent = agents.get(sessionId);
      if (!agent) {
        scopes.delete(sessionId);
        await child.dispose();
        throw new Error(`agent scope failed to materialize: ${sessionId}`);
      }
      return agent;
    },

    async invalidate(sessionId) {
      const scope = scopes.get(sessionId);
      agents.delete(sessionId);
      scopes.delete(sessionId);
      if (scope) await scope.dispose();
    },

    async dispose() {
      agents.clear();
      scopes.clear();
      await hostScope.dispose();
    },
  };
}
