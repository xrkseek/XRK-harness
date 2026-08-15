/**
 * Face human-approval broker — session events are the durable truth;
 * in-memory waiters resolve `pipeline.setApprovalHandler` asks.
 */

import { randomUUID } from "node:crypto";
import type { SessionStore } from "@xrkseek/core-session";
import type {
  ApprovalHandler,
  ToolPipelineContext,
} from "@xrkseek/core-tools";
import type { ApprovalDecisionSource } from "@xrkseek/protocol";

const ARGS_SUMMARY_MAX = 480;

export interface PendingApprovalItem {
  readonly approvalId: string;
  readonly sessionId: string;
  readonly toolCallId: string;
  readonly toolName: string;
  readonly reason: string;
  readonly askedAt: number;
  readonly argsSummary?: string;
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

export class FaceApprovalBroker {
  private readonly waiters = new Map<string, Waiter>();

  constructor(
    private readonly store: SessionStore,
    private readonly onPendingChanged: (sessionId: string) => void,
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
    return (ctx, reason) => this.request(sessionId, ctx, reason);
  }

  async request(
    sessionId: string,
    ctx: ToolPipelineContext,
    reason: string,
  ): Promise<boolean> {
    const approvalId = `apr_${randomUUID()}`;
    const argsSummary = summarizeArgs(ctx.args);
    const askedAt = Date.now();
    const meta: PendingApprovalItem = {
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
      this.onPendingChanged(sessionId);

      if (ctx.signal) {
        const onAbort = () => {
          this.decide(sessionId, approvalId, "deny", "cancel");
        };
        waiter.signal = ctx.signal;
        waiter.abortListener = onAbort;
        if (ctx.signal.aborted) {
          this.decide(sessionId, approvalId, "deny", "cancel");
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
    return this.decide(sessionId, approvalId, decision, "user");
  }

  private decide(
    sessionId: string,
    approvalId: string,
    decision: "allow" | "deny",
    source: ApprovalDecisionSource,
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
    this.store.append(sessionId, {
      type: "approval/decided",
      ts: Date.now(),
      approvalId,
      decision,
      source,
    });
    waiter.resolve(decision === "allow");
    this.onPendingChanged(sessionId);
    return { ok: true };
  }
}
