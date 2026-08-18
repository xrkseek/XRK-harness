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
}

function statusOf(info: ShellJobViewInput): ShellJobViewStatus {
  if (info.status === "exited") return "completed";
  if (info.status === "running") return "running";
  if (info.status === "stopping") return "stopping";
  if (info.status === "killed") return "killed";
  return "failed";
}

function detailOf(info: ShellJobViewInput): string | undefined {
  if (info.detail !== undefined && info.detail.length > 0) return info.detail;
  if (info.exitCode !== undefined && info.exitCode !== null) {
    return `exit code: ${info.exitCode}`;
  }
  if (info.status === "failed" && info.stderr) return info.stderr;
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
  };
}
