/**
 * Face → native Host sidebar bridge (`xrkh-better-sidebar` client contract).
 * HTTP: `createSidebarPublicHandler` (not dsh-compat).
 */
import { readSessionEvents } from "@xrkseek/core-session";
import type { ShellService } from "@xrkseek/exec-shell";
import {
  dispatchFaceMethod,
  hostOpenPath,
  openNativePath,
  type FaceRuntime,
} from "@xrkseek/server-face";
import type {
  SidebarFaceBridge,
  SidebarSubagentLiveActivity,
} from "@xrkseek/server-http";
import { liveLineFromSessionEvents } from "./sidebar-live-line.js";

const JOB_OUTPUT_LIMIT = 256_000;

function collectDescendantIds(face: FaceRuntime, rootSessionId: string): string[] {
  const out: string[] = [];
  const queue = [rootSessionId];
  const seen = new Set<string>([rootSessionId]);
  while (queue.length > 0) {
    const parent = queue.shift()!;
    for (const link of face.subagents.list(parent)) {
      if (seen.has(link.childSessionId)) continue;
      seen.add(link.childSessionId);
      out.push(link.childSessionId);
      queue.push(link.childSessionId);
    }
  }
  return out;
}

export function createSidebarFaceBridgeFromFace(
  face: FaceRuntime,
  deps?: { shell?: ShellService },
): SidebarFaceBridge {
  const shell = deps?.shell;
  return {
    async openExternal(payload) {
      if (payload.action === "url" && payload.url?.trim()) {
        await openNativePath(payload.url.trim());
        return { ok: true };
      }
      if (payload.action === "reveal" && payload.path?.trim()) {
        const opened = await hostOpenPath({
          path: payload.path.trim(),
          reveal: true,
        });
        if (!opened.ok) {
          throw new Error(opened.error.message);
        }
        return { ok: true };
      }
      throw new Error("open.external: invalid payload");
    },

    readJobOutput(jobId) {
      if (!shell) return { text: "", truncated: false };
      const text = shell.readJobOutput(jobId);
      if (text.length > JOB_OUTPUT_LIMIT) {
        return { text: text.slice(0, JOB_OUTPUT_LIMIT), truncated: true };
      }
      return { text, truncated: false };
    },

    async killJob(jobId, reason) {
      if (!shell) {
        return { ok: false, killed: false, reason: "no-background-job-host" };
      }
      try {
        const result = await shell.killJob(jobId, reason);
        return {
          ok: true,
          killed: result === "requested",
          ...(result === "already-finished"
            ? { reason: "already-finished" }
            : {}),
        };
      } catch {
        return { ok: false, killed: false, reason: "not-found" };
      }
    },

    async forkSessionAt(sessionId, beforeSeq) {
      const forked = await dispatchFaceMethod(
        face,
        "session.fork",
        `tr-${Date.now()}`,
        { sessionId, beforeSeq },
      );
      if (!forked.result.ok) {
        throw new Error(
          forked.result.error?.message ?? "session.fork failed",
        );
      }
      const childId = String(
        (forked.result.value as { sessionId: string }).sessionId,
      );
      return { sessionId: childId };
    },

    async listSubagentsLive(rootSessionId) {
      const live: Record<string, SidebarSubagentLiveActivity> = {};
      for (const childId of collectDescendantIds(face, rootSessionId)) {
        if (!face.drain.isActive(childId)) continue;
        const events = readSessionEvents(face.store, childId);
        live[childId] = liveLineFromSessionEvents(events) ?? {};
      }
      return { live };
    },
  };
}
