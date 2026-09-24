/**
 * Package-owned invariant companion for `@xrkseek/core-agent-loop`.
 * @module @xrkseek/core-agent-loop/invariant
 */

import type {
  InvariantInstaller,
  InvariantRegistry,
} from "@xrkseek/runtime-invariants";

const PACKAGE_NAME = "@xrkseek/core-agent-loop";

/**
 * No append-path runtime invariant: request reconstruction is asserted inside
 * `runTurn` via `assertModelVisible` / `durableModelHistory` (see
 * `packages/core/agent-loop/tests/request-reconstruction.test.ts`). Observing
 * the same contract again on SessionStore.append would only duplicate that
 * gate without covering direct one-shot LLM calls.
 */
const install: InvariantInstaller = () => {};

/**
 * Register this package's invariant companion (ownership reservation).
 * @returns disposer that releases ownership.
 */
export function installCoreAgentLoopInvariant(
  registry: InvariantRegistry,
): () => void {
  return registry.register(PACKAGE_NAME, install);
}
