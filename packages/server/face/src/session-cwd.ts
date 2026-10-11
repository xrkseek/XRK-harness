/**
 * Resolve / change the filesystem cwd bound to a session.
 * Prefer live `sessionCwds`, then durable workspace membership, then Host root.
 * Survives Host restart when membership is persisted in workspaces.json.
 *
 * Effective cwd may diverge from the project workspace path after
 * `working_directory` / `create_worktree` (DSH working-directory semantic).
 */
import { existsSync, statSync } from "node:fs";
import path from "node:path";
import type { FaceRuntime } from "./context.js";
import { persistWorkspaceDoc } from "./workspace-store.js";

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

export type SetSessionWorkingDirectoryResult =
  | { readonly ok: true; readonly cwd: string; readonly changed: boolean }
  | { readonly ok: false; readonly error: string };

/** Per-session chain so concurrent set/ensure serialize (DSH WorkingDirectoryService). */
const sessionCwdGates = new Map<string, Promise<unknown>>();

async function withSessionCwdGate<T>(
  sessionId: string,
  run: () => Promise<T>,
): Promise<T> {
  const prev = sessionCwdGates.get(sessionId) ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const pending = prev.then(() => gate);
  sessionCwdGates.set(sessionId, pending);
  await prev.catch(() => {});
  try {
    return await run();
  } finally {
    release();
    if (sessionCwdGates.get(sessionId) === pending) {
      sessionCwdGates.delete(sessionId);
    }
  }
}

function resolveDirectoryTarget(
  requested: string,
  current: string,
): { abs: string } | { error: string } {
  const trimmed = requested.trim();
  if (!trimmed) return { error: "cd must not be empty" };
  const abs = path.isAbsolute(trimmed)
    ? path.resolve(trimmed)
    : path.resolve(current, trimmed);
  try {
    if (!existsSync(abs) || !statSync(abs).isDirectory()) {
      return { error: `directory does not exist: ${abs}` };
    }
  } catch (err) {
    return {
      error: `directory unreadable: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  return { abs };
}

async function setSessionWorkingDirectoryUnlocked(
  runtime: FaceRuntime,
  sessionId: string,
  requested: string,
): Promise<SetSessionWorkingDirectoryResult> {
  const current = resolveSessionCwd(runtime, sessionId);
  const target = resolveDirectoryTarget(requested, current);
  if ("error" in target) return { ok: false, error: target.error };

  const abs = target.abs;
  const previous = path.resolve(current);
  if (abs === previous) {
    runtime.sessionCwds.set(sessionId, abs);
    return { ok: true, cwd: abs, changed: false };
  }

  runtime.sessionCwds.set(sessionId, abs);
  const attach = runtime.workspaces.resolveAttachTarget({ cwd: abs });
  if ("error" in attach) {
    runtime.sessionCwds.set(sessionId, previous);
    return { ok: false, error: attach.error };
  }
  if (attach.workspaceId) {
    runtime.workspaces.attachSession(sessionId, attach.workspaceId);
  }
  await persistWorkspaceDoc(runtime, runtime.workspaces);

  try {
    if (runtime.store.has(sessionId)) {
      runtime.store.append(sessionId, {
        type: "working-directory/change",
        ts: Date.now(),
        cwd: abs,
      });
    }
  } catch {
    /* membership + map already committed; log best-effort */
  }

  void runtime.invalidateAgent?.(sessionId);
  return { ok: true, cwd: abs, changed: true };
}

/**
 * Change one session's effective cwd. Updates `sessionCwds`, durable
 * workspace membership (adopt/create by path), appends
 * `working-directory/change`, and invalidates the bound agent so the next
 * turn rebuilds with the new workspaceRoot.
 * Concurrent calls for the same session are serialized.
 */
export async function setSessionWorkingDirectory(
  runtime: FaceRuntime,
  sessionId: string,
  requested: string,
): Promise<SetSessionWorkingDirectoryResult> {
  return withSessionCwdGate(sessionId, () =>
    setSessionWorkingDirectoryUnlocked(runtime, sessionId, requested),
  );
}

function isUsableDirectory(dir: string): boolean {
  try {
    return existsSync(dir) && statSync(dir).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Validate the current cwd; if missing, restore workspace membership path
 * or Host root and commit the recovery the same way as a normal set.
 * When membership still points at a vanished path, fall through to Host root.
 */
export async function ensureSessionWorkingDirectory(
  runtime: FaceRuntime,
  sessionId: string,
): Promise<SetSessionWorkingDirectoryResult> {
  return withSessionCwdGate(sessionId, async () => {
    const current = resolveSessionCwd(runtime, sessionId);
    if (isUsableDirectory(current)) {
      runtime.sessionCwds.set(sessionId, path.resolve(current));
      return { ok: true, cwd: path.resolve(current), changed: false };
    }
    const wsId = runtime.workspaces.workspaceIdOf(sessionId);
    const row = wsId ? runtime.workspaces.get(wsId) : undefined;
    const candidates = [
      ...(row?.path ? [row.path] : []),
      runtime.workspaceRoot,
    ];
    for (const candidate of candidates) {
      if (!isUsableDirectory(candidate)) continue;
      return setSessionWorkingDirectoryUnlocked(runtime, sessionId, candidate);
    }
    return {
      ok: false,
      error: `no recoverable working directory for session ${sessionId}`,
    };
  });
}
