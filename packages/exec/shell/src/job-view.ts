/**
 * Project a shell job onto the Face `JobView` (DSH apiproxy `jobViews` fields).
 * `exited` → `completed`; producer detail is `exit code: N` when we have one.
 */

export type ShellJobViewStatus =
  | "running"
  | "completed"
  | "killed"
  | "failed";

export interface ShellJobView {
  readonly id: string;
  readonly kind: "bash";
  readonly label: string;
  readonly status: ShellJobViewStatus;
  readonly detail?: string;
  readonly startedAt: number;
  readonly finishedAt?: number;
}

export interface ShellJobViewInput {
  readonly id: string;
  readonly command: string;
  readonly status: "running" | "exited" | "killed" | "failed";
  readonly startedAt: number;
  readonly finishedAt?: number;
  readonly exitCode?: number | null;
  readonly stderr?: string;
}

function statusOf(info: ShellJobViewInput): ShellJobViewStatus {
  if (info.status === "exited") return "completed";
  if (info.status === "running") return "running";
  if (info.status === "killed") return "killed";
  return "failed";
}

function detailOf(info: ShellJobViewInput): string | undefined {
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
    kind: "bash",
    label: info.command,
    status: statusOf(info),
    ...(detail === undefined ? {} : { detail }),
    startedAt: info.startedAt,
    ...(info.finishedAt === undefined ? {} : { finishedAt: info.finishedAt }),
  };
}
