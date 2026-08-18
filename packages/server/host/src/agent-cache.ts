import type { AgentHandle } from "@xrkseek/core-agent";
import {
  createRootScope,
  openSubagentRealm,
  ScopeState,
  type Scope,
} from "@xrkseek/compose";
import type { RegisteredPlugin } from "@xrkseek/server-loader";

/** Realm key: host composition / plugin list snapshot for agent scopes. */
export const HOST_PLUGINS_KEY = "host.plugins";

export interface AgentResolveOpts {
  /** Face subagent / fork parent. Opens C2 realm under the parent scope when cached. */
  readonly parentSessionId?: string;
}

export interface HostAgentCache {
  readonly hostScope: Scope;
  resolve(
    sessionId: string,
    create: () => Promise<AgentHandle>,
    opts?: AgentResolveOpts,
  ): Promise<AgentHandle>;
  /** Drop cached agent with compose Ordering (abort via scope effects). */
  invalidate(sessionId: string): Promise<void>;
  /** Drop every cached agent (e.g. MCP tools/list_changed). */
  invalidateAll(): Promise<void>;
  /** Dispose host scope (all agent children first). */
  dispose(): Promise<void>;
}

/**
 * Agent cache backed by `@xrkseek/compose` Scopes.
 * Root sessions: `agent:{id}`. Subagent sessions: `openSubagentRealm` (`subagent:{id}`).
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

  function pruneDisposed(): void {
    for (const [id, scope] of [...scopes]) {
      if (scope.state === ScopeState.Disposed) {
        scopes.delete(id);
        agents.delete(id);
      }
    }
  }

  function openScope(sessionId: string, parentSessionId?: string): Scope {
    const depend = [{ name: HOST_PLUGINS_KEY }];
    const parentId = parentSessionId?.trim();
    if (parentId) {
      const parent = scopes.get(parentId);
      const root =
        parent && parent.state !== ScopeState.Disposed ? parent : hostScope;
      return openSubagentRealm(root, { sessionId, depend });
    }
    return hostScope.child({
      id: `agent:${sessionId}`,
      depend,
    });
  }

  async function invalidate(sessionId: string): Promise<void> {
    const scope = scopes.get(sessionId);
    agents.delete(sessionId);
    scopes.delete(sessionId);
    if (scope && scope.state !== ScopeState.Disposed) await scope.dispose();
    pruneDisposed();
  }

  async function invalidateAll(): Promise<void> {
    const ids = [...scopes.keys()];
    for (const id of ids) await invalidate(id);
  }

  return {
    hostScope,

    async resolve(sessionId, create, resolveOpts) {
      const existing = agents.get(sessionId);
      if (existing) return existing;

      const child = openScope(sessionId, resolveOpts?.parentSessionId);
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

    invalidate,
    invalidateAll,

    async dispose() {
      agents.clear();
      scopes.clear();
      await hostScope.dispose();
    },
  };
}
