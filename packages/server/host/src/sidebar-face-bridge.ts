/**
 * Face → native Host sidebar bridge (`xrkh-better-sidebar` client contract).
 * HTTP: `createSidebarPublicHandler` (not dsh-compat).
 */
import { readSessionEvents } from "@xrkseek/core-session";
import type { ShellService } from "@xrkseek/exec-shell";
import {
  SUBAGENT_PREVIEW_TEXT_MAX,
  type SubagentPreviewSummary,
} from "@xrkseek/protocol";
import {
  dispatchFaceMethod,
  hostOpenPath,
  isAgentTeamRole,
  lastAssistantBodyText,
  openNativePath,
  toFaceWireSessionEvent,
  type FaceRuntime,
  type FaceSubagentLink,
} from "@xrkseek/server-face";
import type {
  SidebarChangesWireEvent,
  SidebarFaceBridge,
  SidebarSubagentLiveActivity,
} from "@xrkseek/server-http";
import { liveLineFromSessionEvents } from "./sidebar-live-line.js";

const JOB_OUTPUT_LIMIT = 256_000;
const CHANGES_EVENTS_CAP = 4000;

/** BFS over Face subagent links (root excluded). */
function collectDescendantLinks(
  face: FaceRuntime,
  rootSessionId: string,
): FaceSubagentLink[] {
  const out: FaceSubagentLink[] = [];
  const queue = [rootSessionId];
  const seen = new Set<string>([rootSessionId]);
  while (queue.length > 0) {
    const parent = queue.shift()!;
    for (const link of face.subagents.list(parent)) {
      if (seen.has(link.childSessionId)) continue;
      seen.add(link.childSessionId);
      out.push(link);
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

    async forkSessionAt(sessionId, atSeq) {
      const forked = await dispatchFaceMethod(
        face,
        "session.fork",
        `tr-${Date.now()}`,
        { sessionId, atSeq },
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
      for (const link of collectDescendantLinks(face, rootSessionId)) {
        if (link.mode === "fork") continue;
        const childId = link.childSessionId;
        if (!face.drain.isActive(childId)) continue;
        const events = readSessionEvents(face.store, childId);
        live[childId] = liveLineFromSessionEvents(events) ?? {};
      }
      return { live };
    },

    async listSubagentPreviews(rootSessionId) {
      const previews: SubagentPreviewSummary[] = [];
      for (const link of collectDescendantLinks(face, rootSessionId)) {
        if (link.mode === "fork") continue;
        if (!face.store.has(link.childSessionId)) continue;
        const activity = face.drain.isActive(link.childSessionId)
          ? ("running" as const)
          : ("inactive" as const);
        const events = readSessionEvents(face.store, link.childSessionId);
        const live =
          activity === "running"
            ? liveLineFromSessionEvents(events)
            : undefined;
        const last = lastAssistantBodyText(events).trim();
        const lastAssistantPreview =
          last.length === 0
            ? undefined
            : last.length > SUBAGENT_PREVIEW_TEXT_MAX
              ? last.slice(0, SUBAGENT_PREVIEW_TEXT_MAX)
              : last;
        previews.push({
          childSessionId: link.childSessionId,
          mode: link.mode,
          activity,
          ...(link.label ? { label: link.label } : {}),
          ...(live !== undefined ? { live } : {}),
          ...(lastAssistantPreview !== undefined
            ? { lastAssistantPreview }
            : {}),
        });
      }
      return { previews };
    },

    async agentTeamGraph(rootSessionId, action) {
      if (action?.op === "link") {
        if (action.label) {
          face.agentTeams.linkPeers(action.from, action.to, action.label);
        } else {
          face.agentTeams.linkPeers(action.from, action.to);
        }
      } else if (action?.op === "unlink") {
        face.agentTeams.unlinkPeers(action.from, action.to);
      } else if (action?.op === "role") {
        const role = isAgentTeamRole(action.role) ? action.role : undefined;
        face.agentTeams.setRole(action.nodeId, role);
      } else if (action?.op === "remove") {
        face.agentTeams.removeNode(action.nodeId);
      }
      return face.agentTeams.view(rootSessionId);
    },

    async getPlanPreview(sessionId) {
      const plan = face.projections.snapshot(sessionId).values.plan;
      return {
        active: plan?.active === true,
        pending: plan?.pending === true,
      };
    },

    listChangesOps(sessionId, afterSeq) {
      const events = readSessionEvents(face.store, sessionId);
      const wireCtx = { sessionId, ids: face.wireIds };
      const filtered: SidebarChangesWireEvent[] = [];
      for (let i = 0; i < events.length; i += 1) {
        const ev = events[i]!;
        if (ev.type !== "tool/call" && ev.type !== "tool/result") continue;
        const seq = i + 1;
        if (seq <= afterSeq) continue;
        filtered.push(toFaceWireSessionEvent(ev, seq, wireCtx));
      }
      const window =
        filtered.length > CHANGES_EVENTS_CAP
          ? filtered.slice(filtered.length - CHANGES_EVENTS_CAP)
          : filtered;
      return {
        events: window,
        lastSeq: window.at(-1)?.seq ?? Math.max(afterSeq, 0),
      };
    },
  };
}
