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
