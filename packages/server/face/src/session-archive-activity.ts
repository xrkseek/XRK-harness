/**
 * Session activity snapshot used before archive admission.
 *
 * XRK already cancels the turn on archive (Face path). What we still take from
 * DSH: do not silently archive while work is visibly running — refuse with a
 * structured list, require explicit `force` to stop + archive.
 *
 * Scope is intentionally narrow (drain + live jobs + live child subagents).
 * No empty four-family provider seams — those would be ceremony without a
 * schedule store wired the same way DSH has.
 */
import { createSessionScopedShell } from "@xrkseek/exec-shell";
import type { FaceRuntime } from "./context.js";

export type ArchiveActivityKind = "turn" | "job" | "subagent";

export type ArchiveActivityItem = {
  readonly kind: ArchiveActivityKind;
  readonly id: string;
  readonly title: string;
};

export function collectArchiveActivity(
  runtime: FaceRuntime,
  sessionId: string,
): readonly ArchiveActivityItem[] {
  const items: ArchiveActivityItem[] = [];

  if (runtime.drain.isActive(sessionId)) {
    items.push({
      kind: "turn",
      id: sessionId,
      title: "session turn running",
    });
  }

  const shell = runtime.shell
    ? createSessionScopedShell(runtime.shell, sessionId)
    : undefined;
  if (shell) {
    for (const job of shell.listJobsNow()) {
      if (job.status !== "running" && job.status !== "stopping") continue;
      items.push({
        kind: "job",
        id: job.id,
        title: job.command || job.id,
      });
    }
  }

  for (const link of runtime.subagents.list(sessionId)) {
    if (!runtime.drain.isActive(link.childSessionId)) continue;
    items.push({
      kind: "subagent",
      id: link.childSessionId,
      title: link.label.trim() || link.childSessionId,
    });
  }

  return items;
}
