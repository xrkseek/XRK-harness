/**
 * `/auto-review approve N` — locate a pending Auto-review Face approval and
 * respond allow (DSH user-approval fallback). Index is 0-based (slash `approve 1`
 * → 0). Only waiters whose audit reason looks like Auto review are considered.
 */
import type { FaceApprovalBroker, PendingApprovalItem } from "./approvals.js";

export type AutoReviewApproveOutcome =
  | {
      readonly kind: "allowed";
      readonly toolName: string;
      readonly approvalId: string;
      readonly note: string;
    }
  | {
      readonly kind: "missing";
      readonly note: string;
    };

/** English audit reason from {@link askOutcome} / host gates. */
export function isAutoReviewPendingApproval(
  item: Pick<PendingApprovalItem, "reason">,
): boolean {
  return /\bAuto review\b/i.test(item.reason);
}

export function listPendingAutoReviewApprovals(
  approvals: Pick<FaceApprovalBroker, "listPending">,
  sessionId?: string,
): readonly PendingApprovalItem[] {
  return approvals
    .listPending(sessionId)
    .filter((item) => isAutoReviewPendingApproval(item));
}

/**
 * Allow the Nth pending Auto-review approval for a session (oldest-first).
 * Does not mutate dsh-compat stats — caller may still sync slash / HTTP stats.
 */
export function approvePendingAutoReview(
  approvals: Pick<FaceApprovalBroker, "listPending" | "respond">,
  sessionId: string,
  index: number,
): AutoReviewApproveOutcome {
  const pending = listPendingAutoReviewApprovals(approvals, sessionId);
  if (pending.length === 0) {
    return {
      kind: "missing",
      note: "no pending auto-review approval to allow",
    };
  }
  if (!Number.isSafeInteger(index) || index < 0 || index >= pending.length) {
    return {
      kind: "missing",
      note: `no pending auto-review approval at index ${index + 1} (${pending.length} pending)`,
    };
  }
  const item = pending[index]!;
  const out = approvals.respond(sessionId, item.approvalId, "allow");
  if (!out.ok) {
    return {
      kind: "missing",
      note: `could not allow pending auto-review: ${out.message}`,
    };
  }
  return {
    kind: "allowed",
    toolName: item.toolName,
    approvalId: item.approvalId,
    note: `allowed pending auto-review for tool "${item.toolName}"`,
  };
}
