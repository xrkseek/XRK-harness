import type { AgentHandle } from "@xrkseek/core-agent";
import {
  createRootScope,
  ScopeState,
  type Scope,
} from "@xrkseek/compose";
import type { RegisteredPlugin } from "@xrkseek/server-loader";

/** Realm key: host composition / plugin list snapshot for agent scopes. */
export const HOST_PLUGINS_KEY = "host.plugins";

export interface AgentResolveOpts {
  /**
   * Accepted for callers that still pass a summoning session id. Agent scopes
   * are never nested under it — session lifetimes stay independent.
   */
  readonly parentSessionId?: string;
}

/**
 * Badge / cwd rebuilds share the settings rule: do not dispose a live turn
 * (or a mid-build materialize — `isBusy` is still false then). The caller
 * invalidates the deferred id once that session's drain goes idle.
 *
 * `force` is for intentional rebuilds that must win over an in-flight create
 * (isolated worktree cwd bind): those callers await invalidate then prompt.
 */
export function deferBusyAgentInvalidate(input: {
  readonly sessionId: string;
  readonly drainActive: boolean;
  readonly busy: boolean;
  /** True while {@link HostAgentCache.resolve} is still building this id. */
  readonly materializing?: boolean;
  /** Tear down even while busy / draining / materializing. */
  readonly force?: boolean;
  readonly defer: (sessionId: string) => void;
  readonly invalidate: (sessionId: string) => Promise<void> | void;
}): Promise<void> | void {
  if (
    !input.force
    && (input.drainActive || input.busy || input.materializing === true)
  ) {
    input.defer(input.sessionId);
    return;
  }
  return input.invalidate(input.sessionId);
}

export interface InvalidateAllOpts {
  /**
   * Skip dispose/abort for matching sessions (e.g. mid-turn MCP remount via
   * `settings_mutate`). Caller should invalidate them once the turn is idle.
   */
  readonly skip?: (sessionId: string) => boolean;
  /**
   * Sessions held only because a nested child was skipped. Parent dispose
   * cascades through compose and would abort that busy child — so the parent
   * stays until the child drains. Same pending-invalidate bookkeeping as skip.
   */
  readonly onHold?: (sessionId: string) => void;
}

export interface HostAgentCache {
  readonly hostScope: Scope;
  resolve(
    sessionId: string,
    create: () => Promise<AgentHandle>,
    opts?: AgentResolveOpts,
  ): Promise<AgentHandle>;
  /** True while the cached agent latch is mid-turn (stream / tools). */
  isBusy(sessionId: string): boolean;
  /**
   * True while a resolve is building this session's agent. Such a session has a
   * scope but no registered handle yet, so `isBusy` is false — callers that
   * decide whether it is safe to drop caches must treat it as protected.
   */
  isMaterializing(sessionId: string): boolean;
  /**
   * True when a nested child realm under this session is still protected
   * (busy / drain-active / pending invalidate). Drain flush must not dispose
   * such a parent — compose cascade would abort that child.
   */
  hasProtectedNestedChild(
    sessionId: string,
    isProtected: (sessionId: string) => boolean,
  ): boolean;
  /** Drop cached agent with compose Ordering (abort via scope effects). */
  invalidate(sessionId: string): Promise<void>;
  /** Drop every cached agent (e.g. MCP tools/list_changed). */
  invalidateAll(opts?: InvalidateAllOpts): Promise<void>;
  /** Dispose host scope (all agent children first). */
  dispose(): Promise<void>;
}

/**
 * Agent cache backed by `@xrkseek/compose` Scopes.
 * Root sessions and delegated workers share one shape: `agent:{id}` under the host scope.
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
  /** In-flight materialize per session; a second resolve waits instead of rebuilding. */
  const materializing = new Map<string, Promise<AgentHandle>>();
  /** Child → parent when the child realm is nested under the parent's scope. */
  const nestParent = new Map<string, string>();

  function pruneDisposed(): void {
    for (const [id, scope] of [...scopes]) {
      if (scope.state === ScopeState.Disposed) {
        scopes.delete(id);
        agents.delete(id);
        nestParent.delete(id);
      }
    }
    for (const [child, parent] of [...nestParent]) {
      if (!scopes.has(child) || !scopes.has(parent)) nestParent.delete(child);
    }
  }

  function hasProtectedNestedChild(
    sessionId: string,
    isProtected: (id: string) => boolean,
  ): boolean {
    for (const [child, parent] of nestParent) {
      if (parent !== sessionId) continue;
      if (isProtected(child)) return true;
      if (hasProtectedNestedChild(child, isProtected)) return true;
    }
    return false;
  }

  function openScope(sessionId: string, _parentSessionId?: string): Scope {
    // Every session is an independent agent lifetime. Nesting under the
    // summoning session made parent invalidate/dispose cascade-abort the
    // worker (`disposed` / 「已停止」) even though the worker's log, wait,
    // and background reply are their own session.
    nestParent.delete(sessionId);
    return hostScope.child({
      id: `agent:${sessionId}`,
      depend: [{ name: HOST_PLUGINS_KEY }],
    });
  }

  async function invalidate(sessionId: string): Promise<void> {
    const scope = scopes.get(sessionId);
    agents.delete(sessionId);
    scopes.delete(sessionId);
    nestParent.delete(sessionId);
    for (const [child, parent] of [...nestParent]) {
      if (parent === sessionId) nestParent.delete(child);
    }
    if (scope && scope.state !== ScopeState.Disposed) await scope.dispose();
    pruneDisposed();
  }

  async function invalidateAll(opts?: InvalidateAllOpts): Promise<void> {
    pruneDisposed();
    const ids = [...scopes.keys()];
    const held = new Set<string>();
    for (const id of ids) {
      if (opts?.skip?.(id)) held.add(id);
    }
    // Skip on a nested child must also hold ancestors: parent.scope.dispose()
    // cascades and would abort the busy child that skip meant to protect.
    let grew = true;
    while (grew) {
      grew = false;
      for (const [child, parent] of nestParent) {
        if (!held.has(child) || held.has(parent) || !scopes.has(parent)) {
          continue;
        }
        held.add(parent);
        opts?.onHold?.(parent);
        grew = true;
      }
    }
    for (const id of ids) {
      if (held.has(id)) continue;
      await invalidate(id);
    }
  }

  /**
   * Build one session's agent and register it.
   *
   * Only ever entered through {@link resolve}, which owns the single-flight
   * bookkeeping — two callers arriving during the same window used to see
   * "scope present, handle absent" and each rebuild: the second caller disposed
   * the first one's scope mid-`create()`, and the first threw
   * `agent scope disposed during materialize`. Every delegated spawn hits that
   * window (drain admit + spawn warm-up resolve the same fresh session id at
   * once), so it surfaced as "subagents are broken" rather than a rare race.
   */
  async function materialize(
    sessionId: string,
    create: () => Promise<AgentHandle>,
    resolveOpts?: AgentResolveOpts,
  ): Promise<AgentHandle> {
    const existingScope = scopes.get(sessionId);
    const existing = agents.get(sessionId);
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
      // A cache-wide invalidate can still cascade-dispose this scope while
      // create() awaits (MCP remount, settings ns change); refuse to register
      // effects on a terminal scope.
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
  }

  return {
    hostScope,

    resolve(sessionId, create, resolveOpts) {
      pruneDisposed();
      const existingScope = scopes.get(sessionId);
      const existing = agents.get(sessionId);
      if (
        existing &&
        existingScope &&
        existingScope.state !== ScopeState.Disposed
      ) {
        return Promise.resolve(existing);
      }
      const inflight = materializing.get(sessionId);
      if (inflight) return inflight;
      // One retry: a concurrent per-session invalidate (cwd / badge) can still
      // dispose the scope while create() awaits — invalidateAll already skips
      // materializing, but deferBusy used to treat mid-build as idle.
      const run = materialize(sessionId, create, resolveOpts).catch((err) => {
        const msg = err instanceof Error ? err.message : String(err);
        if (!msg.includes("agent scope disposed during materialize:")) {
          throw err;
        }
        return materialize(sessionId, create, resolveOpts);
      });
      materializing.set(sessionId, run);
      void run.then(
        () => {
          if (materializing.get(sessionId) === run) materializing.delete(sessionId);
        },
        () => {
          if (materializing.get(sessionId) === run) materializing.delete(sessionId);
        },
      );
      return run;
    },

    isBusy(sessionId) {
      return agents.get(sessionId)?.isBusy() === true;
    },

    isMaterializing(sessionId) {
      return materializing.has(sessionId);
    },

    hasProtectedNestedChild,

    invalidate,
    invalidateAll,

    async dispose() {
      agents.clear();
      scopes.clear();
      await hostScope.dispose();
    },
  };
}
