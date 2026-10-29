/**
 * Product-side adapters: what the bridge needs from a host that runs
 * `core-agent` rather than the DSH agent service.
 *
 * Two jobs:
 *
 * 1. {@link createProductAgent} — present a product handle as the structural
 *    `ModAgent` the `$` implementation reads. Every member it cannot supply is
 *    left absent so the one `$` call that needs it fails with a named reason
 *    rather than reading `undefined`.
 * 2. {@link discoverClaudeCodePluginDirs} — find installed Claude Code plugins
 *    under a root, accepting both "a root of plugin directories" and "a root
 *    that is itself one plugin".
 * @module
 */

import { readdir, stat } from "node:fs/promises";
import path from "node:path";

import type { ModAgent } from "./types.js";

export interface ProductAgentInput {
  /** Session identity, used for `$.session.id` and the `$.state` scope. */
  readonly sessionId: string;
  /** Committed working directory for `$.session.cwd` and `$.fs` resolution. */
  readonly cwd: string;
  /** Session creation time in epoch milliseconds, when the host knows it. */
  readonly createdAt?: number;
  readonly model?: string;
  /** Messages the model currently sees; omit when the host has no derivation. */
  readonly messages?: () => readonly { readonly role: string }[];
  /** Submit a prompt as the user (`$.prompt.submit`). */
  readonly followup?: (message: unknown) => void;
  /** Seed model-facing context (`$.tool.call` guidance). */
  readonly inject?: (message: unknown) => void;
}

/**
 * Adapt a product session handle to {@link ModAgent}.
 *
 * The result is a plain object, not a live agent: it reads the session facts the
 * bridge asks for and nothing else. A `$` call that needs a member the host did
 * not supply throws with that member named.
 */
export function createProductAgent(input: ProductAgentInput): ModAgent {
  return {
    id: input.sessionId,
    ...(input.model === undefined ? {} : { options: { model: input.model } }),
    session: {
      id: input.sessionId,
      header: {
        cwd: input.cwd,
        ...(input.createdAt === undefined ? {} : { createdAt: input.createdAt }),
      },
      ...(input.messages === undefined ? {} : { deriveMessages: input.messages }),
    },
    ...(input.followup === undefined ? {} : { followup: input.followup }),
    ...(input.inject === undefined ? {} : { inject: input.inject }),
  };
}

async function isDirectory(target: string): Promise<boolean> {
  try {
    return (await stat(target)).isDirectory();
  } catch {
    return false;
  }
}

async function isPluginDir(target: string): Promise<boolean> {
  return stat(path.join(target, ".claude-plugin", "plugin.json")).then(
    (info) => info.isFile(),
    () => false,
  );
}

/**
 * Find Claude Code plugin directories under `root`.
 *
 * Layouts accepted:
 *
 * - `root/<plugin>/.claude-plugin/plugin.json` — a directory of installed
 *   plugins (what a plugin manager writes).
 * - `root/.claude-plugin/plugin.json` — `root` is one plugin.
 *
 * A missing root is an empty list, not an error: a host with no plugins
 * installed is the normal state, and it must not fail composition. Results are
 * sorted by directory name so plugin load order (and therefore chain order) is
 * stable across filesystems.
 */
export async function discoverClaudeCodePluginDirs(
  root: string,
): Promise<readonly string[]> {
  if (await isPluginDir(root)) return [root];
  if (!(await isDirectory(root))) return [];

  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  const found: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
    if (entry.name === "node_modules") continue;
    const candidate = path.join(root, entry.name);
    if (await isPluginDir(candidate)) found.push(candidate);
  }
  found.sort();
  return found;
}
