/**
 * Working-directory seam.
 *
 * Upstream this is `dsh-working-directory`: a service that answers "which
 * directory does this agent's filesystem work resolve against", verified at
 * `session.start` and committed for the life of the session. Our sessions
 * already carry that fact durably (`session.header.cwd`, validated as an
 * absolute path when the session is created), so the service here is a thin
 * read over it plus a fallback for agents created outside a workspace.
 *
 * A deployment with a richer notion of "current directory" (a workspace switch
 * mid-session, a per-turn chdir) supplies its own service instead of composing
 * this one.
 */

import type { Agent } from "@xrkseek/xrk-agent";

export interface WorkingDirectoryService {
  /**
   * The directory this agent's file and process work resolves against.
   *
   * @param agent - the agent whose session owns the directory.
   * @param signal - active cancellation; a host that verifies the directory
   *   (stat, permission probe) must honour it.
   * @returns an absolute path.
   */
  ensure(agent: Agent, signal?: AbortSignal): Promise<string>;
}

declare module "@xrkseek/cordis" {
  interface Context {
    workingDirectory: WorkingDirectoryService;
  }
}

export interface SessionWorkingDirectoryOptions {
  /** Directory used when a session carries no `cwd` of its own. */
  readonly fallback?: string;
}

/**
 * Compose the session-header implementation of {@link WorkingDirectoryService}.
 *
 * Nothing is verified here beyond what session creation already enforced: the
 * header's `cwd` was required to be an absolute path when the session was made,
 * and re-probing the filesystem on every `$` call would make `$.fs` cost a
 * `stat` before every read for no added safety.
 */
export function createSessionWorkingDirectory(
  options: SessionWorkingDirectoryOptions = {},
): WorkingDirectoryService {
  const fallback = options.fallback ?? process.cwd();
  return {
    ensure: async (agent) => agent.session.header.cwd ?? fallback,
  };
}
