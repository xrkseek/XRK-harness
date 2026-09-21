import type { CodeRuntime } from "@xrkseek/code-runtime";
import type { FsService } from "@xrkseek/exec-fs";
import type { SubprocessService } from "@xrkseek/exec-subprocess";
import type { SshTargetConfig } from "./config.js";
import { createSshCodeRuntime } from "./code.js";
import { createFsSshProvider } from "./fs.js";
import { createSshSession, type CreateSshSessionOptions, type SshSession } from "./session.js";
import { createSshSubprocess } from "./subprocess.js";

export interface SshExecutionWorld {
  readonly session: SshSession;
  readonly workspaceRoot: string;
  readonly fs: FsService;
  readonly subprocess: SubprocessService;
  readonly codeRuntime: CodeRuntime;
  dispose(): void;
}

export interface CreateSshExecutionWorldOptions
  extends Omit<CreateSshSessionOptions, "config"> {
  readonly config: SshTargetConfig;
}

/** Build fs + subprocess + code providers for one SSH target. */
export function createSshExecutionWorld(
  options: CreateSshExecutionWorldOptions,
): SshExecutionWorld {
  const session = createSshSession(options);
  const fs = createFsSshProvider({ session });
  const subprocess = createSshSubprocess(session);
  const codeRuntime = createSshCodeRuntime(session);
  return {
    session,
    workspaceRoot: session.config.workspace,
    fs,
    subprocess,
    codeRuntime,
    dispose() {
      session.dispose();
    },
  };
}
