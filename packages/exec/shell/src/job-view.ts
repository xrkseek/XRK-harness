/**
 * Project a shell/managed job onto the Face `JobView` (DSH apiproxy `jobViews`).
 * `exited` → `completed`; producer detail is `exit code: N` or managed `detail`.
 */

export type ShellJobViewStatus =
  | "running"
  | "stopping"
  | "completed"
  | "killed"
  | "failed";

export interface ShellJobView {
  readonly id: string;
  readonly kind: string;
  readonly label: string;
  readonly status: ShellJobViewStatus;
  readonly detail?: string;
  readonly startedAt: number;
  readonly finishedAt?: number;
  readonly foreground?: boolean;
}

export interface ShellJobViewInput {
  readonly id: string;
  readonly kind?: string;
  readonly command: string;
  readonly status: "running" | "stopping" | "exited" | "killed" | "failed";
  readonly startedAt: number;
  readonly finishedAt?: number;
  readonly exitCode?: number | null;
  readonly stderr?: string;
  /** Managed-job producer detail (e.g. `wait: stdin_read`). */
  readonly detail?: string;
  /** True while a foreground tool call is attached. */
  readonly foreground?: boolean;
}

function statusOf(info: ShellJobViewInput): ShellJobViewStatus {
  if (info.status === "exited") return "completed";
  if (info.status === "running") return "running";
  if (info.status === "stopping") return "stopping";
  if (info.status === "killed") return "killed";
  return "failed";
}

/** Cap for the error line carried in the wire `detail` (UI card / completion notice). */
const FAILED_DETAIL_MAX_CHARS = 160;

/**
 * First non-blank stderr line, bounded. Bash failures put their real error
 * here (`npm ERR! code E409`, `Error: …`, first stack frame); the completion
 * notice and UI card surface this instead of a bare `exit code: N`.
 */
function firstErrorLine(stderr: string | undefined): string | undefined {
  if (stderr === undefined) return undefined;
  const line = stderr
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  if (line === undefined) return undefined;
  return line.length > FAILED_DETAIL_MAX_CHARS
    ? `${line.slice(0, FAILED_DETAIL_MAX_CHARS - 1)}…`
    : line;
}

function detailOf(info: ShellJobViewInput): string | undefined {
  if (info.detail !== undefined && info.detail.length > 0) return info.detail;
  const failed =
    info.status === "failed" ||
    (info.exitCode !== undefined && info.exitCode !== null && info.exitCode !== 0);
  if (failed) {
    const errorLine = firstErrorLine(info.stderr);
    if (errorLine !== undefined) return errorLine;
  }
  if (info.exitCode !== undefined && info.exitCode !== null) {
    return `exit code: ${info.exitCode}`;
  }
  return undefined;
}

export function toJobView(info: ShellJobViewInput): ShellJobView {
  const detail = detailOf(info);
  return {
    id: info.id,
    kind: info.kind ?? "bash",
    label: info.command,
    status: statusOf(info),
    ...(detail === undefined ? {} : { detail }),
    startedAt: info.startedAt,
    ...(info.finishedAt === undefined ? {} : { finishedAt: info.finishedAt }),
    ...(info.foreground ? { foreground: true as const } : {}),
  };
}
