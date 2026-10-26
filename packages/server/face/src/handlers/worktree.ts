/**
 * Face RPC for managed worktree fold-back and main-session create.
 */

import { asRecord, type FaceHandler } from "./types.js";
import { resolveSessionCwd, setSessionWorkingDirectory } from "../session-cwd.js";
import { createSessionWorktree } from "../session-worktree.js";

/**
 * `worktree.merge` — fold a managed lease into the parent checkout.
 * Payload: `{ leaseId, pruneAfter?, strategy? }` where strategy is `ff-only`
 * (default) or `rebase-ff`. Conflict / dirty parent → ok:false, lease retained.
 */
export const worktreeMerge: FaceHandler = async (runtime, _rpcId, payload) => {
  const p = asRecord(payload);
  const leaseId = String(p.leaseId ?? "").trim();
  if (!leaseId) {
    return {
      ok: false,
      error: { code: "invalid-payload", message: "leaseId required" },
    };
  }
  const pruneAfter = p.pruneAfter === true;
  // Anything but an explicit `rebase-ff` stays on the conservative default:
  // replaying commits rewrites the child branch, so it must be asked for.
  const strategy = p.strategy === "rebase-ff" ? "rebase-ff" : "ff-only";
  const result = runtime.managedWorktrees.mergeIntoParent(leaseId, {
    pruneAfter,
    strategy,
  });
  if (!result) {
    return {
      ok: false,
      error: {
        code: "worktree-not-found",
        message: `unknown managed worktree lease: ${leaseId}`,
      },
    };
  }
  return { ok: true, value: result };
};

/**
 * `worktree.reconcile` — mark leases whose checkout vanished as `lost`.
 * Startup runs this once; the RPC exists for a long-lived Face where the
 * checkout was removed by hand after boot. Payload: none.
 */
export const worktreeReconcile: FaceHandler = async (runtime) => ({
  ok: true,
  value: runtime.managedWorktrees.reconcile(),
});

/**
 * `worktree.create` — allocate a linked checkout under `.xrk/worktrees/<name>`
 * and enter it (session cwd). Payload: `{ sessionId, name?, from? }`.
 */
export const worktreeCreate: FaceHandler = async (runtime, _rpcId, payload) => {
  const p = asRecord(payload);
  const sessionId = String(p.sessionId ?? "").trim();
  if (!sessionId) {
    return {
      ok: false,
      error: { code: "invalid-payload", message: "sessionId required" },
    };
  }
  if (!runtime.store.has(sessionId)) {
    return {
      ok: false,
      error: { code: "session-not-found", message: `unknown session: ${sessionId}` },
    };
  }
  const name =
    typeof p.name === "string" && p.name.trim() ? p.name.trim() : undefined;
  const from =
    typeof p.from === "string" && p.from.trim() ? p.from.trim() : undefined;
  const sourceCwd = resolveSessionCwd(runtime, sessionId);
  const created = createSessionWorktree(sourceCwd, {
    ...(name !== undefined ? { name } : {}),
    ...(from !== undefined ? { from } : {}),
  });
  if (!created.ok) {
    return {
      ok: false,
      error: { code: "worktree-create-failed", message: created.error },
    };
  }
  const entered = await setSessionWorkingDirectory(
    runtime,
    sessionId,
    created.value.path,
  );
  if (!entered.ok) {
    return {
      ok: false,
      error: {
        code: "worktree-enter-failed",
        message: `${entered.error}. Checkout retained at ${created.value.path} (branch ${created.value.branch}).`,
      },
    };
  }
  return {
    ok: true,
    value: {
      ...created.value,
      cwd: entered.cwd,
    },
  };
};
