/**
 * @anionex/dsh-turn-rewind — checkpoint preview/restore (file-backed index).
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { sendJson } from "./underlying/http-json.js";
import { DSH_COMPAT_ADAPTER } from "./meta.js";
import { parseJsonBody } from "./underlying/http-kit.js";
import type { SidebarFaceBridge } from "./sidebar-face-bridge.js";
import {
  findRewindMarker,
  type RewindMarker,
} from "./turn-rewind-store.js";
import { restoreRewindWorkspace } from "./turn-rewind-workspace.js";

export interface TurnRewindOptions {
  readonly xrkHome?: string;
  readonly workspaceRoot?: string;
  readonly defaultCwd?: string;
  readonly resolveSessionCwd?: (sessionId: string) => string | undefined;
  readonly sidebarFace?: SidebarFaceBridge;
}

export type { RewindMarker } from "./turn-rewind-store.js";
export { upsertRewindMarker, findRewindMarker } from "./turn-rewind-store.js";
export { recordRewindFromGit, restoreRewindWorkspace } from "./turn-rewind-workspace.js";

function readyPreview(
  marker: RewindMarker,
  offset = 0,
): Record<string, unknown> {
  const page = marker.changes.slice(offset);
  const branch = marker.checkpointBranch || marker.currentBranch || "main";
  const current = marker.currentBranch || branch;
  return {
    status: "ready",
    sessionId: marker.sessionId,
    messageSeq: marker.messageSeq,
    turn: marker.turn,
    turnStartSeq: marker.turnStartSeq,
    checkpointId: marker.checkpointId,
    checkpointBranch: branch,
    currentBranch: current,
    checkpointHead: marker.checkpointHead ?? "",
    currentHead: marker.currentHead ?? "",
    checkpointOperation: "",
    currentOperation: "",
    headChanged: branch !== current,
    operationChanged: false,
    activeSessionIds: [],
    restoreBlocked: false,
    totalChanges: marker.changes.length,
    changes: page,
    offset,
    truncated: offset + page.length < marker.changes.length,
    ...(marker.planId ? { planId: marker.planId } : {}),
    ...(marker.confirmation ? { confirmation: marker.confirmation } : {}),
    adapter: DSH_COMPAT_ADAPTER,
  };
}

export async function handleTurnRewindHttp(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  options: TurnRewindOptions,
): Promise<boolean> {
  if (pathname !== "/turn-rewind") return false;
  const method = (req.method ?? "GET").toUpperCase();
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  const sessionId = url.searchParams.get("sessionId") ?? "";
  const messageSeq = Number(url.searchParams.get("messageSeq") ?? "0");
  const details = url.searchParams.get("details") === "1";
  const offset = Number(url.searchParams.get("offset") ?? "0");

  if (method === "GET" || method === "HEAD") {
    if (!sessionId || !messageSeq) {
      sendJson(res, 400, {
        code: "BAD_REQUEST",
        error: "sessionId and messageSeq required",
      });
      return true;
    }
    const marker = findRewindMarker(options.xrkHome, sessionId, messageSeq);
    if (!marker) {
      sendJson(res, 200, { status: "missing", adapter: DSH_COMPAT_ADAPTER });
      return true;
    }
    sendJson(res, 200, readyPreview(marker, details ? offset : 0));
    return true;
  }

  if (method === "POST") {
    const body = await parseJsonBody(req);
    const sid = typeof body.sessionId === "string" ? body.sessionId : "";
    const seq =
      typeof body.messageSeq === "number" ? body.messageSeq : messageSeq;
    const marker = findRewindMarker(options.xrkHome, sid, seq);
    if (!marker) {
      sendJson(res, 409, {
        code: "CHECKPOINT_MISSING",
        error: "no checkpoint for this message",
        adapter: DSH_COMPAT_ADAPTER,
      });
      return true;
    }
    const mode = typeof body.mode === "string" ? body.mode : "code";
    const bodyPlanId =
      typeof body.planId === "string" ? body.planId : undefined;
    const bodyConfirmation =
      typeof body.confirmation === "string" ? body.confirmation : undefined;
    if (
      (marker.planId && bodyPlanId !== marker.planId) ||
      (marker.confirmation && bodyConfirmation !== marker.confirmation)
    ) {
      sendJson(res, 409, {
        code: "PLAN_STALE",
        error: "checkpoint plan is stale; refresh preview",
        adapter: DSH_COMPAT_ADAPTER,
      });
      return true;
    }
    const cwd =
      (typeof body.cwd === "string" && body.cwd.trim()
        ? body.cwd.trim()
        : undefined) ??
      options.workspaceRoot ??
      options.defaultCwd ??
      process.cwd();
    const shouldRestore = mode === "code" || mode === "both";
    const shouldFork = mode === "chat" || mode === "both";
    const restored = shouldRestore
      ? restoreRewindWorkspace(marker, cwd, options.xrkHome)
      : false;
    let resultSessionId = sid;
    if (shouldFork) {
      const bridge = options.sidebarFace;
      if (!bridge?.forkSessionAt) {
        sendJson(res, 503, {
          code: "FORK_UNAVAILABLE",
          error: "session fork requires XRK Host Face bridge",
          adapter: DSH_COMPAT_ADAPTER,
        });
        return true;
      }
      try {
        const forked = await bridge.forkSessionAt(sid, marker.messageSeq);
        resultSessionId = forked.sessionId;
      } catch (error) {
        sendJson(res, 409, {
          code: "FORK_FAILED",
          error:
            error instanceof Error ? error.message : "session.fork failed",
          adapter: DSH_COMPAT_ADAPTER,
        });
        return true;
      }
    }
    sendJson(res, 200, {
      mode,
      rescuePointId: marker.checkpointId,
      sessionId: resultSessionId,
      restored,
      adapter: DSH_COMPAT_ADAPTER,
    });
    return true;
  }

  sendJson(res, 405, { error: "method not allowed" });
  return true;
}

export function isTurnRewindPath(pathname: string): boolean {
  return pathname === "/turn-rewind";
}
