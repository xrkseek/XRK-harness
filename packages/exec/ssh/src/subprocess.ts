import type {
  SpawnOptions,
  SubprocessHandle,
  SubprocessService,
} from "@xrkseek/exec-subprocess";
import { shJoin } from "./quote.js";
import type { SshSession } from "./session.js";

/**
 * SubprocessService whose argv runs on the remote host (Hermes terminal backend).
 * Paths in argv/cwd are execution-world (remote) coordinates.
 */
export function createSshSubprocess(session: SshSession): SubprocessService {
  return {
    start(argv, opts?: SpawnOptions): SubprocessHandle {
      return session.start(shJoin(argv), {
        cwd: opts?.cwd ?? session.config.workspace,
        ...(opts?.env ? { env: opts.env } : {}),
        ...(opts?.signal ? { signal: opts.signal } : {}),
        ...(opts?.timeoutMs !== undefined
          ? { timeoutMs: opts.timeoutMs }
          : {}),
      });
    },
    async spawn(argv, opts?: SpawnOptions) {
      return session.exec(shJoin(argv), {
        cwd: opts?.cwd ?? session.config.workspace,
        ...(opts?.env ? { env: opts.env } : {}),
        ...(opts?.signal ? { signal: opts.signal } : {}),
        ...(opts?.timeoutMs !== undefined
          ? { timeoutMs: opts.timeoutMs }
          : {}),
      });
    },
  };
}
