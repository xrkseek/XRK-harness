/**
 * Resolve the filesystem cwd bound to a session.
 * Prefer live `sessionCwds`, then durable workspace membership, then Host root.
 * Survives Host restart when membership is persisted in workspaces.json.
 */
import path from "node:path";
import type { FaceRuntime } from "./context.js";

export function resolveSessionCwd(
  runtime: FaceRuntime,
  sessionId: string,
): string {
  const mapped = runtime.sessionCwds.get(sessionId);
  if (mapped) return path.resolve(mapped);
  const wsId = runtime.workspaces.workspaceIdOf(sessionId);
  if (wsId) {
    const row = runtime.workspaces.get(wsId);
    if (row) return path.resolve(row.path);
  }
  return path.resolve(runtime.workspaceRoot);
}

/**
 * Attach a child session to the parent's workspace — never the Host default
 * root just because `sessionCwds` is briefly empty.
 * Prefer durable membership, then a registry row whose path equals the
 * parent's cwd. Callers pass the result to `resolveAttachTarget` (exactly one
 * of workspaceId / cwd).
 */
export function resolveParentWorkspaceAttach(
  runtime: FaceRuntime,
  parentSessionId: string,
): { workspaceId: string } | { cwd: string } {
  const parentWs = runtime.workspaces.workspaceIdOf(parentSessionId);
  if (parentWs && runtime.workspaces.get(parentWs)) {
    return { workspaceId: parentWs };
  }
  return { cwd: resolveSessionCwd(runtime, parentSessionId) };
}
