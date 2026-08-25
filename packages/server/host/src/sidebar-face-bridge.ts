/**
 * Face → dsh-better-sidebar sidechat / open.external bridge.
 */
import type { ShellService } from "@xrkseek/exec-shell";
import type { SessionEvent } from "@xrkseek/protocol";
import {
  dispatchFaceMethod,
  hostOpenPath,
  openNativePath,
  type FaceRuntime,
} from "@xrkseek/server-face";
import type { SidebarFaceBridge } from "@xrkseek/server-http";

const JOB_OUTPUT_LIMIT = 256_000;

function parentOf(face: FaceRuntime, childId: string): string | undefined {
  return face.subagents.getByChild(childId)?.parentSessionId;
}

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

function liveLineFromEvents(
  events: readonly SessionEvent[],
): { text?: string; tool?: string; args?: string } | undefined {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const ev = events[i]!;
    if (ev.type === "assistant/chunk") {
      if (ev.kind === "tool-call" && ev.toolName) {
        return {
          tool: ev.toolName,
          ...(ev.argumentsDelta
            ? { args: ev.argumentsDelta.slice(0, 120) }
            : {}),
        };
      }
      const text = ev.text?.trim();
      if (text) return { text: text.slice(0, 200) };
      continue;
    }
    if (ev.type === "assistant/message") {
      const text = ev.content?.trim();
      if (text) return { text: text.slice(0, 200) };
      continue;
    }
    if (ev.type === "tool/call") {
      const raw =
        typeof ev.call.arguments === "string"
          ? ev.call.arguments
          : JSON.stringify(ev.call.arguments ?? {});
      return {
        tool: ev.call.name,
        args: raw.slice(0, 120),
      };
    }
  }
  return undefined;
}

export function createSidebarFaceBridgeFromFace(
  face: FaceRuntime,
  deps?: { shell?: ShellService },
): SidebarFaceBridge {
  const shell = deps?.shell;
  return {
    async startSidechat(parentSessionId, question) {
      const created = await dispatchFaceMethod(
        face,
        "session.create",
        `sc-${Date.now()}`,
        {
          parentSessionId,
          label: "Side: New",
          mode: "continuable",
        },
      );
      if (!created.result.ok) {
        throw new Error(
          created.result.error?.message ?? "session.create failed",
        );
      }
      const childId = String(
        (created.result.value as { sessionId: string }).sessionId,
      );
      const q = question?.trim();
      if (q) {
        const prompted = await dispatchFaceMethod(
          face,
          "subagent.prompt",
          `sc-p-${childId}`,
          {
            parentSessionId,
            childSessionId: childId,
            mode: "continuable",
            content: [{ type: "text", text: q }],
          },
        );
        if (!prompted.result.ok) {
          throw new Error(
            prompted.result.error?.message ?? "sidechat prompt failed",
          );
        }
      }
      return { childId };
    },

    async promptSidechat(childId, text) {
      const parentSessionId = parentOf(face, childId);
      if (!parentSessionId) throw new Error("sidechat-parent-missing");
      const prompted = await dispatchFaceMethod(
        face,
        "subagent.prompt",
        `sc-pr-${childId}`,
        {
          parentSessionId,
          childSessionId: childId,
          mode: "continuable",
          content: [{ type: "text", text }],
        },
      );
      if (!prompted.result.ok) {
        throw new Error(
          prompted.result.error?.message ?? "sidechat prompt failed",
        );
      }
      return { ok: true };
    },

    async cancelSidechat(childId) {
      const parentSessionId = parentOf(face, childId);
      if (!parentSessionId) throw new Error("sidechat-parent-missing");
      const stopped = await dispatchFaceMethod(
        face,
        "subagent.interrupt",
        `sc-ca-${childId}`,
        {
          parentSessionId,
          childSessionId: childId,
          mode: "continuable",
        },
      );
      if (!stopped.result.ok) {
        throw new Error(
          stopped.result.error?.message ?? "sidechat cancel failed",
        );
      }
      return { ok: true };
    },

    async disposeSidechat(childId) {
      const cancelled = await dispatchFaceMethod(
        face,
        "session.cancel",
        `sc-di-${childId}`,
        { sessionId: childId },
      );
      if (!cancelled.result.ok) {
        throw new Error(
          cancelled.result.error?.message ?? "sidechat dispose failed",
        );
      }
      return { ok: true };
    },

    async infoSidechat(childId) {
      const preset = face.sessionAgentPresets.get(childId);
      const modelRow = face.sessionModels.get(childId);
      const provider =
        typeof modelRow?.provider === "string" ? modelRow.provider : undefined;
      const model =
        typeof modelRow?.model === "string" ? modelRow.model : undefined;
      return {
        ...(preset ? { preset } : {}),
        ...(provider ? { provider } : {}),
        ...(model ? { model } : {}),
      };
    },

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
      const live: Record<
        string,
        { text?: string; tool?: string; args?: string }
      > = {};
      for (const childId of collectDescendantIds(face, rootSessionId)) {
        if (!face.drain.isActive(childId)) continue;
        const events = face.store.get(childId).events;
        live[childId] = liveLineFromEvents(events) ?? {};
      }
      return { live };
    },
  };
}
