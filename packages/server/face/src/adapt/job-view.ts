/**
 * Wire `JobView` (copied from `@xrkseek/xrk-host-apiproxy` `api/jobs.ts`).
 * Registry internals (`ownerSession`, `reported`, `outputLimitBytes`) stay off
 * the wire — the mux frame's `sessionId` is the owner.
 */

import { Buffer } from "node:buffer";

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

/** Face tool-jobs `fitCompletionNotice` (optional UTF-8 cap). */
export function formatJobCompletionNotice(
  job: JobView,
  maxBytes?: number,
): string {
  const status =
    job.detail !== undefined
      ? `[status: ${job.status}, ${job.detail}]`
      : `[status: ${job.status}]`;
  const prefix = `background job ${job.id}`;
  const detail = ` (${job.kind}: ${job.label}) finished ${status}`;
  const action = "\nDone; job_output.";
  const complete = `${prefix}${detail}. Read its output with job_output.`;
  if (maxBytes === undefined || maxBytes <= 0) {
    return `${prefix}${detail}. Read its output with job_output.`;
  }
  if (Buffer.byteLength(complete) <= maxBytes) return complete;
  const omitted = "\n[notice truncated]";
  const fixed = `${prefix}${omitted}${action}`;
  const fixedBytes = Buffer.byteLength(fixed);
  if (fixedBytes <= maxBytes) {
    if (fixedBytes === maxBytes) return fixed;
    const budget = maxBytes - fixedBytes;
    const chars = Array.from(detail);
    let bytes = 0;
    let end = 0;
    while (end < chars.length) {
      const next = Buffer.byteLength(chars[end]!);
      if (bytes + next > budget) break;
      bytes += next;
      end += 1;
    }
    return `${prefix}${chars.slice(0, end).join("")}${omitted}${action}`;
  }
  const compact = `${prefix}${action}`;
  if (Buffer.byteLength(compact) <= maxBytes) return compact;
  const actionBytes = Buffer.byteLength(action);
  if (actionBytes >= maxBytes) {
    const chars = Array.from(action);
    let bytes = 0;
    let start = chars.length;
    while (start > 0) {
      const next = Buffer.byteLength(chars[start - 1]!);
      if (bytes + next > maxBytes) break;
      bytes += next;
      start -= 1;
    }
    return chars.slice(start).join("");
  }
  const headBudget = maxBytes - actionBytes;
  const chars = Array.from(prefix);
  let bytes = 0;
  let end = 0;
  while (end < chars.length) {
    const next = Buffer.byteLength(chars[end]!);
    if (bytes + next > headBudget) break;
    bytes += next;
    end += 1;
  }
  return `${chars.slice(0, end).join("")}${action}`;
}

export function isSettledJobStatus(status: JobViewStatus): boolean {
  return status !== "running" && status !== "stopping";
}

/** Face `maxConsecutiveWakes` default. */
export const JOB_COMPLETION_MAX_WAKES = 3;

