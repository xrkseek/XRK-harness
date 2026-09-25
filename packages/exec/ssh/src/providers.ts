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

/**
 * Create the SSH world and fail fast if BatchMode cannot run `true`
 * (Hermes establish-before-use). Set `XRK_SSH_SKIP_PROBE=1` to skip (CI mocks).
 */
export async function createSshExecutionWorldReady(
  options: CreateSshExecutionWorldOptions & {
    readonly probeTimeoutMs?: number;
    readonly skipProbe?: boolean;
  },
): Promise<SshExecutionWorld> {
  const world = createSshExecutionWorld(options);
  const skip =
    options.skipProbe === true ||
    String(process.env.XRK_SSH_SKIP_PROBE ?? "").trim() === "1";
  if (skip) return world;
  const timeoutMs = Math.max(1_000, options.probeTimeoutMs ?? 15_000);
  try {
    const result = await world.session.exec("true", { timeoutMs });
    if (result.exitCode === 0) return world;
    const stderr = (result.stderr ?? "").trim();
    throw new Error(
      stderr ||
        `ssh ${world.session.target} exited ${result.exitCode ?? "?"} (BatchMode probe)`,
    );
  } catch (err) {
    world.dispose();
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(
      `SSH probe failed for ${world.session.target}: ${message}`,
      { cause: err },
    );
  }
}
