/**
 * Append `job/registered` / `job/settled` facts for owned shell jobs.
 *
 * Sync on registry notify (before waiters resume). Journal failures warn only —
 * they must not block cleanup or Face mux publish.
 */
import type { SessionStore } from "@xrkseek/core-session";
import type { ShellJobInfo, ShellService } from "@xrkseek/exec-shell";

function warnJournal(err: unknown): void {
  const message = err instanceof Error ? err.message : String(err);
  console.warn(`[face] job session journal failed: ${message}`);
}

function isTerminal(
  status: ShellJobInfo["status"],
): status is "exited" | "killed" | "failed" {
  return status === "exited" || status === "killed" || status === "failed";
}

/** Subscribe once; returns unsubscribe. */
export function wireJobSessionJournal(
  shell: ShellService,
  store: SessionStore,
): () => void {
  const registered = new Set<string>();
  const settled = new Set<string>();

  const appendRegistered = (job: ShellJobInfo): void => {
    const owner = job.ownerSessionId?.trim();
    if (!owner || !store.has(owner)) return;
    const key = job.recordId;
    if (registered.has(key)) return;
    registered.add(key);
    try {
      store.append(owner, {
        type: "job/registered",
        ts: Date.now(),
        jobId: job.recordId,
        liveId: job.id,
        kind: job.kind,
        label: job.command,
        startedAt: job.startedAt,
      });
    } catch (err) {
      registered.delete(key);
      warnJournal(err);
    }
  };

  const appendSettled = (job: ShellJobInfo): void => {
    const owner = job.ownerSessionId?.trim();
    if (!owner || !store.has(owner)) return;
    if (!isTerminal(job.status)) return;
    const key = job.recordId;
    if (settled.has(key)) return;
    // Ensure register lands first when notify races settle in one tick.
    appendRegistered(job);
    settled.add(key);
    try {
      store.append(owner, {
        type: "job/settled",
        ts: Date.now(),
        jobId: job.recordId,
        liveId: job.id,
        status: job.status,
        finishedAt: job.finishedAt ?? Date.now(),
        producerReported: job.producerReported === true,
        ...(job.exitCode !== undefined ? { exitCode: job.exitCode } : {}),
        ...(job.detail !== undefined && job.detail.length > 0
          ? { detail: job.detail }
          : {}),
      });
    } catch (err) {
      settled.delete(key);
      warnJournal(err);
    }
  };

  const sync = (): void => {
    for (const job of shell.listJobsNow()) {
      appendRegistered(job);
      if (isTerminal(job.status)) appendSettled(job);
    }
  };
  sync();
  return shell.onJobsChanged(sync);
}
