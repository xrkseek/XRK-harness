/**
 * Wire `JobView` (copied from `@deepseek-ai/dsh-host-apiproxy` `api/jobs.ts`).
 * Registry internals (`ownerSession`, `reported`, `outputLimitBytes`) stay off
 * the wire — the mux frame's `sessionId` is the owner.
 */

export type JobViewStatus =
  | "running"
  | "stopping"
  | "completed"
  | "killed"
  | "failed";

export interface JobView {
  readonly id: string;
  readonly kind: string;
  readonly label: string;
  readonly status: JobViewStatus;
  readonly detail?: string;
  readonly startedAt: number;
  readonly finishedAt?: number;
}

/**
 * Project snapshots onto the wire view, dropping internal fields.
 * Copied from apiproxy `jobViews`.
 */
export function jobViews(snapshots: readonly JobView[]): JobView[] {
  return snapshots.map((job) => ({
    id: job.id,
    kind: job.kind,
    label: job.label,
    status: job.status,
    ...(job.detail === undefined ? {} : { detail: job.detail }),
    startedAt: job.startedAt,
    ...(job.finishedAt === undefined ? {} : { finishedAt: job.finishedAt }),
  }));
}

export interface FaceJobsSource {
  list(): readonly JobView[];
  onJobsChanged(listener: () => void): () => void;
}
