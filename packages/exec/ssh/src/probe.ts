/**
 * SSH target connectivity probe (Hermes `_establish_connection` subset).
 * One BatchMode `true` over OpenSSH — no remote helper install.
 */

import type { SubprocessService } from "@xrkseek/exec-subprocess";
import type { SshTargetConfig } from "./config.js";
import { createSshSession, type CreateSshSessionOptions } from "./session.js";

export interface SshProbeResult {
  readonly ok: boolean;
  readonly target: string;
  readonly detail: string;
  readonly exitCode?: number;
  readonly stderr?: string;
}

export interface ProbeSshTargetOptions
  extends Omit<CreateSshSessionOptions, "config"> {
  readonly config: SshTargetConfig;
  /** Default 15s (matches session ConnectTimeout floor). */
  readonly timeoutMs?: number;
  readonly local?: SubprocessService;
}

/**
 * Probe that OpenSSH can run a trivial remote command in BatchMode.
 * Always disposes the ephemeral session (doctor / CLI).
 */
export async function probeSshTarget(
  options: ProbeSshTargetOptions,
): Promise<SshProbeResult> {
  const timeoutMs = Math.max(1_000, options.timeoutMs ?? 15_000);
  const session = createSshSession({
    config: options.config,
    ...(options.local ? { local: options.local } : {}),
    ...(options.platform ? { platform: options.platform } : {}),
  });
  try {
    const result = await session.exec("true", { timeoutMs });
    if (result.exitCode === 0) {
      return {
        ok: true,
        target: session.target,
        detail: `ssh ${session.target} · BatchMode ok · workspace ${options.config.workspace}`,
      };
    }
    const stderr = (result.stderr ?? "").trim();
    return {
      ok: false,
      target: session.target,
      detail:
        stderr ||
        `ssh ${session.target} exited ${result.exitCode ?? "?"} (BatchMode)`,
      ...(result.exitCode !== undefined ? { exitCode: result.exitCode } : {}),
      ...(stderr ? { stderr } : {}),
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      target: session.target,
      detail: `ssh ${session.target}: ${message}`,
    };
  } finally {
    session.dispose();
  }
}
