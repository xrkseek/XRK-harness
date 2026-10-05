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
  /**
   * Tool-delegated parent only. Opens a C2 realm under that parent's scope when
   * the parent is still Active/Loading; otherwise falls back to the host root.
   * UI/rewind forks must omit this (root `agent:{id}`).
   */
  readonly parentSessionId?: string;
}

export interface InvalidateAllOpts {
  /**
   * Skip dispose/abort for matching sessions (e.g. mid-turn MCP remount via
   * `settings_mutate`). Caller should invalidate them once the turn is idle.
   */
  readonly skip?: (sessionId: string) => boolean;
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
  invalidateAll(opts?: InvalidateAllOpts): Promise<void>;
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

  function parentUsable(scope: Scope | undefined): scope is Scope {
    return (
      scope !== undefined &&
      (scope.state === ScopeState.Active || scope.state === ScopeState.Loading)
    );
  }

  function openScope(sessionId: string, parentSessionId?: string): Scope {
    const depend = [{ name: HOST_PLUGINS_KEY }];
    const parentId = parentSessionId?.trim();
    if (parentId) {
      const parent = scopes.get(parentId);
      // Unloading / Failed / Disposed parents cannot accept `.child()` —
      // nest under host instead so a late child resolve still materializes.
      const root = parentUsable(parent) ? parent : hostScope;
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

  async function invalidateAll(opts?: InvalidateAllOpts): Promise<void> {
    const ids = [...scopes.keys()];
    for (const id of ids) {
      if (opts?.skip?.(id)) continue;
      await invalidate(id);
    }
  }

  return {
    hostScope,

    async resolve(sessionId, create, resolveOpts) {
      pruneDisposed();
      const existingScope = scopes.get(sessionId);
      const existing = agents.get(sessionId);
      if (
        existing &&
        existingScope &&
        existingScope.state !== ScopeState.Disposed
      ) {
        return existing;
      }
      if (existing || existingScope) {
        agents.delete(sessionId);
        scopes.delete(sessionId);
        if (existingScope && existingScope.state !== ScopeState.Disposed) {
          await existingScope.dispose();
        }
      }

      const child = openScope(sessionId, resolveOpts?.parentSessionId);
      scopes.set(sessionId, child);

      await child.activate(async () => {
        // Touch inject so consumer edge is live for Ordering on host dispose.
        child.inject(HOST_PLUGINS_KEY);
        const agent = await create();
        // Parent invalidate can cascade-dispose this scope while create()
        // awaits; refuse to register effects on a terminal scope.
        if (
          child.state !== ScopeState.Loading &&
          child.state !== ScopeState.Active
        ) {
          agent.abort({ kind: "disposed" });
          throw new Error(
            `agent scope disposed during materialize: ${sessionId}`,
          );
        }
        child.effect(
          () => () => {
            agent.abort({ kind: "disposed" });
          },
          { label: `agent.abort(${sessionId})` },
        );
        agents.set(sessionId, agent);
      });

      const agent = agents.get(sessionId);
      if (!agent) {
        scopes.delete(sessionId);
        if (child.state !== ScopeState.Disposed) await child.dispose();
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
