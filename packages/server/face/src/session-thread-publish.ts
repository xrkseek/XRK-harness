/**
 * Push 主线 / 支线 chrome to the shell after thread_* mutations.
 * session.list already carries these fields; without a live frame the sidebar
 * keeps the first-message title until the next full list refresh.
 */
import type { FaceRuntime } from "./context.js";
import type { HostFrame } from "./types.js";

export function sessionThreadFrame(
  runtime: FaceRuntime,
  workspaceId: string,
  sessionId: string,
): Extract<HostFrame, { type: "host/session-thread" }> {
  const bind = runtime.sessionThreads.bindOf(workspaceId, sessionId);
  const thread = bind
    ? runtime.sessionThreads.get(workspaceId, bind.threadId)
    : undefined;
  const sideline = bind?.sideline ?? runtime.presence.get(sessionId)?.tips;
  return {
    type: "host/session-thread",
    sessionId,
    bound: thread !== undefined,
    ...(thread
      ? { mainline: thread.title, mainlineId: thread.id }
      : {}),
    ...(sideline ? { sideline } : {}),
  };
}

/** Publish chrome for one session. */
export function publishSessionThread(
  runtime: FaceRuntime,
  workspaceId: string,
  sessionId: string,
): void {
  runtime.bus.publishHost(sessionThreadFrame(runtime, workspaceId, sessionId));
}

/** Publish chrome for every listed session (e.g. after a 主线 title revise). */
export function publishSessionThreads(
  runtime: FaceRuntime,
  workspaceId: string,
  sessionIds: readonly string[],
): void {
  for (const sessionId of sessionIds) {
    publishSessionThread(runtime, workspaceId, sessionId);
  }
}

/** Sessions currently attached to a 主线 in this workspace. */
export function sessionIdsOnThread(
  runtime: FaceRuntime,
  workspaceId: string,
  threadId: string,
): string[] {
  return runtime.sessionThreads
    .listBinds(workspaceId)
    .filter((row) => row.threadId === threadId)
    .map((row) => row.sessionId);
}
