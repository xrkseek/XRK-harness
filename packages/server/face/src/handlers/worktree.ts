/**
 * Face RPC for managed worktree fold-back (ff-only merge into parent).
 */

import { asRecord, type FaceHandler } from "./types.js";

/**
 * `worktree.merge` — fold a managed lease into the parent checkout.
 * Payload: `{ leaseId, pruneAfter? }`. Conflict / dirty parent → ok:false, lease retained.
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
  const result = runtime.managedWorktrees.mergeIntoParent(leaseId, {
    pruneAfter,
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
