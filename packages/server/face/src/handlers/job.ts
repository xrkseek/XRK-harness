import {
  createSessionScopedShell,
  type ShellService,
} from "@xrkseek/exec-shell";
import { asRecord, type FaceHandler } from "./types.js";

function parseJobTarget(payload: unknown): {
  sessionId: string;
  jobId: string;
} | { error: { code: "invalid-payload"; message: string } } {
  const p = asRecord(payload);
  const sessionId = String(p.sessionId ?? "").trim();
  const jobId = String(p.jobId ?? "").trim();
  if (!sessionId || !jobId) {
    return {
      error: {
        code: "invalid-payload",
        message: "sessionId and jobId required",
      },
    };
  }
  return { sessionId, jobId };
}

function scopedShell(
  shell: ShellService | undefined,
  sessionId: string,
): ShellService | undefined {
  if (!shell) return undefined;
  return createSessionScopedShell(shell, sessionId);
}

const jobHostUnavailable = {
  ok: false as const,
  error: {
    code: "job-host-unavailable" as const,
    message: "background job host unavailable",
  },
};

export const jobKill: FaceHandler = async (runtime, _rpcId, payload) => {
  const target = parseJobTarget(payload);
  if ("error" in target) return { ok: false, error: target.error };
  const shell = scopedShell(runtime.shell, target.sessionId);
  if (!shell) return jobHostUnavailable;
  try {
    const outcome = await shell.killJob(target.jobId);
    return { ok: true, value: { outcome } };
  } catch {
    return {
      ok: false,
      error: {
        code: "job-not-found",
        message: target.jobId,
        details: target,
      },
    };
  }
};

export const jobBackground: FaceHandler = async (runtime, _rpcId, payload) => {
  const target = parseJobTarget(payload);
  if ("error" in target) return { ok: false, error: target.error };
  const shell = scopedShell(runtime.shell, target.sessionId);
  if (!shell) return jobHostUnavailable;
  try {
    if (!shell.detachForegroundWait(target.jobId)) {
      return {
        ok: false,
        error: {
          code: "job-not-foreground",
          message: target.jobId,
          details: target,
        },
      };
    }
    return { ok: true, value: { accepted: true as const } };
  } catch {
    return {
      ok: false,
      error: {
        code: "job-not-found",
        message: target.jobId,
        details: target,
      },
    };
  }
};
