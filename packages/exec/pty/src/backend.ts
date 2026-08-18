import type { PtyBackendConfig } from "./config.js";
import { resolvePtyCwd } from "./cwd.js";
import type { SpawnTerminalFn } from "./handle.js";
import { CONTROLLED_PROMPT } from "./sanitize.js";
import { LocalPtySession } from "./session.js";
import {
  TerminalBackendCleanupError,
  type TerminalBackend,
  type TerminalBackendSpawnSpec,
} from "./types.js";

export interface BashTerminalBackendOptions {
  readonly config: PtyBackendConfig;
  readonly workspaceRoot: string;
  readonly spawnTerminal: SpawnTerminalFn;
  readonly wrapArgv?: (
    argv: readonly string[],
    cwd?: string,
  ) => readonly string[];
}

/**
 * Deliberate terminal overrides only — spawn applies scrubbedParentEnv then
 * merges these (CV DSH terminal-bash `childEnvironment`).
 */
function childEnvironment(spec: TerminalBackendSpawnSpec): NodeJS.ProcessEnv {
  return {
    TERM: "dumb",
    PAGER: "cat",
    GIT_PAGER: "cat",
    PS1: CONTROLLED_PROMPT,
    // Re-assert PS1 after the marker when a command overwrote the shell variable.
    PROMPT_COMMAND: `printf "\\033]133;D;%s\\007" "$?"; PS1='${CONTROLLED_PROMPT}'`,
    BASH_SILENCE_DEPRECATION_WARNING: "1",
    XRK_SHELL: "1",
    XRK_PTY_SESSION_ID: spec.sessionId,
    ...(spec.ownerSessionId !== undefined
      ? { XRK_SESSION_ID: spec.ownerSessionId }
      : {}),
  };
}

export function createBashTerminalBackend(
  options: BashTerminalBackendOptions,
): TerminalBackend {
  const { config, workspaceRoot, spawnTerminal, wrapArgv } = options;
  return {
    type: config.backendType,
    async spawn(spec) {
      spec.signal?.throwIfAborted();
      const cwd = resolvePtyCwd(workspaceRoot, spec.cwd);
      const rawArgv = [config.shellPath, ...config.shellArgs];
      const argv = wrapArgv ? [...wrapArgv(rawArgv, cwd)] : rawArgv;
      if (argv[0] === undefined) {
        throw new Error("pty: sandbox returned empty argv");
      }
      const terminal = await spawnTerminal({
        argv,
        cwd,
        env: childEnvironment(spec),
        rows: config.rows,
        cols: config.cols,
        graceMs: config.disposeGraceMs,
        ...(spec.signal ? { signal: spec.signal } : {}),
      });
      const session = new LocalPtySession(terminal, config);
      try {
        if (spec.signal) {
          const signal = spec.signal;
          let onAbort: (() => void) | undefined;
          const aborted = new Promise<never>((_, reject) => {
            onAbort = () => reject(signal.reason);
            signal.addEventListener("abort", onAbort, { once: true });
          });
          try {
            signal.throwIfAborted();
            await Promise.race([session.initialize(signal), aborted]);
          } finally {
            if (onAbort) signal.removeEventListener("abort", onAbort);
          }
        } else {
          await session.initialize();
        }
        return session;
      } catch (error) {
        try {
          await session.close("PTY startup failed");
        } catch (closeError: unknown) {
          throw new TerminalBackendCleanupError(error, closeError);
        }
        throw error;
      }
    },
  };
}
