/**
 * Face human-approval broker — session events are the durable truth;
 * mux pushes DSH `approval/requested` (stable rpcId) settled by POST /api/respond
 * or `session.respondApproval`.
 */

import { randomUUID } from "node:crypto";
import type { SessionStore } from "@xrkseek/core-session";
import type {
  ApprovalHandler,
  ToolPipelineContext,
} from "@xrkseek/core-tools";
import type { ApprovalDecisionSource } from "@xrkseek/protocol";
import { effectiveApprovalPolicy } from "@xrkseek/protocol";
import type { FaceRpcReceipt, MuxFrame } from "./types.js";

const ARGS_SUMMARY_MAX = 480;

export type ApprovalOutcomeWire =
  | "allowed-once"
  | "rejected"
  | "cancelled"
  | "unavailable";

export interface PendingApprovalItem {
  /** Stable server-request rpcId for DSH Web `/api/respond`. */
  readonly rpcId: string;
  readonly approvalId: string;
  readonly sessionId: string;
  readonly toolCallId: string;
  readonly toolName: string;
  readonly reason: string;
  readonly askedAt: number;
  readonly argsSummary?: string;
}

export interface FaceApprovalHooks {
  onRequested(item: PendingApprovalItem): void;
  onResolved(
    sessionId: string,
    approvalId: string,
    outcome: ApprovalOutcomeWire,
  ): void;
}

type Waiter = {
  readonly sessionId: string;
  readonly meta: PendingApprovalItem;
  resolve: (allow: boolean) => void;
  abortListener?: () => void;
  signal?: AbortSignal;
};

function summarizeArgs(args: unknown): string | undefined {
  try {
    const raw = JSON.stringify(args);
    if (raw === undefined) return undefined;
    if (raw.length <= ARGS_SUMMARY_MAX) return raw;
    return `${raw.slice(0, ARGS_SUMMARY_MAX)}…`;
  } catch {
    return undefined;
  }
}

function mintRpcId(): string {
  return `aprpc_${randomUUID()}`;
}

export class FaceApprovalBroker {
  private readonly waiters = new Map<string, Waiter>();
  private readonly byRpcId = new Map<string, string>();

  constructor(
    private readonly store: SessionStore,
    private readonly hooks: FaceApprovalHooks,
  ) {}

  listPending(sessionId?: string): readonly PendingApprovalItem[] {
    const out: PendingApprovalItem[] = [];
    for (const w of this.waiters.values()) {
      if (sessionId === undefined || w.sessionId === sessionId) {
        out.push(w.meta);
      }
    }
    return out;
  }

  /** Pipeline `ApprovalHandler` bound to a session. */
  handlerFor(sessionId: string): ApprovalHandler {
    return async (ctx, reason) => {
      if (effectiveApprovalPolicy(this.store.get(sessionId).events) === "never") {
        return true;
      }
      return this.request(sessionId, ctx, reason);
    };
  }

  async request(
    sessionId: string,
    ctx: ToolPipelineContext,
    reason: string,
  ): Promise<boolean> {
    const approvalId = `apr_${randomUUID()}`;
    const rpcId = mintRpcId();
    const argsSummary = summarizeArgs(ctx.args);
    const askedAt = Date.now();
    const meta: PendingApprovalItem = {
      rpcId,
      approvalId,
      sessionId,
      toolCallId: ctx.call.id,
      toolName: ctx.call.name,
      reason,
      askedAt,
      ...(argsSummary !== undefined ? { argsSummary } : {}),
    };

    this.store.append(sessionId, {
      type: "approval/asked",
      ts: askedAt,
      approvalId,
      toolCallId: ctx.call.id,
      toolName: ctx.call.name,
      reason,
      ...(argsSummary !== undefined ? { argsSummary } : {}),
    });

    return await new Promise<boolean>((resolve) => {
      let settled = false;
      const finish = (allow: boolean) => {
        if (settled) return;
        settled = true;
        if (waiter.signal && waiter.abortListener) {
          waiter.signal.removeEventListener("abort", waiter.abortListener);
        }
        resolve(allow);
      };

      const waiter: Waiter = {
        sessionId,
        meta,
        resolve: finish,
      };

      this.waiters.set(approvalId, waiter);
      this.byRpcId.set(rpcId, approvalId);
      this.hooks.onRequested(meta);

      if (ctx.signal) {
        const onAbort = () => {
          this.decide(sessionId, approvalId, "deny", "cancel", "cancelled");
        };
        waiter.signal = ctx.signal;
        waiter.abortListener = onAbort;
        if (ctx.signal.aborted) {
          this.decide(sessionId, approvalId, "deny", "cancel", "cancelled");
          return;
        }
        ctx.signal.addEventListener("abort", onAbort, { once: true });
      }
    });
  }

  respond(
    sessionId: string,
    approvalId: string,
    decision: "allow" | "deny",
  ):
    | { readonly ok: true }
    | { readonly ok: false; readonly code: string; readonly message: string } {
    return this.decide(
      sessionId,
      approvalId,
      decision,
      "user",
      decision === "allow" ? "allowed-once" : "rejected",
    );
  }

  /**
   * Settle via DSH `POST /api/respond` (rpcId correlation).
   * @returns receipt shape consumed by the Web client.
   */
  respondByRpcId(rpcId: string, value: unknown): FaceRpcReceipt {
    const approvalId = this.byRpcId.get(rpcId);
    if (!approvalId) {
      return { accepted: false, reason: "not-pending" };
    }
    const waiter = this.waiters.get(approvalId);
    if (!waiter) {
      return { accepted: false, reason: "not-pending" };
    }

    if (!value || typeof value !== "object") {
      return { accepted: false, reason: "bad-response" };
    }
    const v = value as Record<string, unknown>;
    if (typeof v.sessionId === "string" && v.sessionId !== waiter.sessionId) {
      return { accepted: false, reason: "bad-response" };
    }
    if (typeof v.approvalId === "string" && v.approvalId !== approvalId) {
      return { accepted: false, reason: "bad-response" };
    }
    const outcome = v.outcome;
    if (outcome !== "allowed-once" && outcome !== "rejected") {
      return { accepted: false, reason: "bad-response" };
    }

    const decided = this.decide(
      waiter.sessionId,
      approvalId,
      outcome === "allowed-once" ? "allow" : "deny",
      "user",
      outcome,
    );
    if (!decided.ok) {
      return { accepted: false, reason: "not-pending" };
    }
    return { accepted: true };
  }

  private decide(
    sessionId: string,
    approvalId: string,
    decision: "allow" | "deny",
    source: ApprovalDecisionSource,
    outcome: ApprovalOutcomeWire,
  ):
    | { readonly ok: true }
    | { readonly ok: false; readonly code: string; readonly message: string } {
    const waiter = this.waiters.get(approvalId);
    if (!waiter) {
      return {
        ok: false,
        code: "approval-not-found",
        message: approvalId,
      };
    }
    if (waiter.sessionId !== sessionId) {
      return {
        ok: false,
        code: "approval-session-mismatch",
        message: `approval ${approvalId} belongs to ${waiter.sessionId}`,
      };
    }

    this.waiters.delete(approvalId);
    this.byRpcId.delete(waiter.meta.rpcId);
    this.store.append(sessionId, {
      type: "approval/decided",
      ts: Date.now(),
      approvalId,
      decision,
      source,
    });
    waiter.resolve(decision === "allow");
    this.hooks.onResolved(sessionId, approvalId, outcome);
    return { ok: true };
  }
}

/** mux `approval/requested` 载荷（rpcId 走 bus/信封，不在 payload 里）。 */
export function approvalRequestedFrame(
  item: PendingApprovalItem,
): Extract<MuxFrame, { type: "approval/requested" }> {
  return {
    type: "approval/requested",
    sessionId: item.sessionId,
    approvalId: item.approvalId,
    toolName: item.toolName,
    callId: item.toolCallId,
    reason: item.reason,
  };
}

export function approvalResolvedFrame(
  sessionId: string,
  approvalId: string,
  outcome: ApprovalOutcomeWire,
): Extract<MuxFrame, { type: "approval/resolved" }> {
  return {
    type: "approval/resolved",
    sessionId,
    approvalId,
    outcome,
  };
}
