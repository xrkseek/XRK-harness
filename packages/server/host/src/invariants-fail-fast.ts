/**
 * Optional Host fail-fast wiring for package-owned runtime invariants.
 * Enabled by `XRK_INVARIANTS_FAIL_FAST=1` (see `@xrkseek/runtime-invariants`).
 */

import { installCoreAgentLoopInvariant } from "@xrkseek/core-agent-loop/invariant";
import { installCoreSessionInvariant } from "@xrkseek/core-session/invariant";
import type { SessionStore } from "@xrkseek/core-session";
import {
  createInvariantRegistry,
  replaySessionLog,
  wrapSessionStore,
  type InvariantRegistry,
} from "@xrkseek/runtime-invariants";

export interface InvariantsFailFastResult {
  readonly store: SessionStore;
  readonly registry: InvariantRegistry;
}

/**
 * Mount core companions and wrap the SessionStore for live append checks.
 * Replays existing durable logs so cold Host boot fails fast on corrupt state.
 */
export function mountInvariantsFailFast(
  store: SessionStore,
): InvariantsFailFastResult {
  const registry = createInvariantRegistry({ enabled: true });
  installCoreSessionInvariant(registry);
  installCoreAgentLoopInvariant(registry);

  for (const sessionId of store.list()) {
    replaySessionLog(registry, sessionId, store.get(sessionId).events);
  }

  return {
    store: wrapSessionStore(store, registry),
    registry,
  };
}
