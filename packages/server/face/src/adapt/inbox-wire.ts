/**
 * Map XRK prompt/* durable admits onto Face wire `agent/inbox/spliced`.
 * Coordinates are computed by replaying pending lists.
 */

import type { MessageContent, SessionEvent } from "@xrkseek/protocol";
import { asContentBlocks } from "@xrkseek/protocol";

export type InboxTarget = "next-turn" | "next-step";

export interface DshWireUserMessage {
  readonly id: string;
  readonly role: "user";
  readonly content: readonly (
    | { readonly type: "text"; readonly text: string }
    | {
        readonly type: "image";
        readonly attachment: {
          readonly attachmentId: string;
          readonly mediaType: string;
          readonly bytes: number;
          readonly width: number;
          readonly height: number;
          readonly name?: string;
        };
      }
  )[];
  readonly source: {
    readonly kind: "user";
    readonly rpcId?: string;
  };
}

export interface DshInboxSplice {
  readonly target: InboxTarget;
  readonly start: number;
  readonly removedCount?: number;
  readonly inserted: readonly DshWireUserMessage[];
  readonly outcome?: "canceled";
}

function userMessage(
  id: string,
  content: MessageContent,
  rpcId?: string,
): DshWireUserMessage {
  return {
    id,
    role: "user",
    content: asContentBlocks(content).map((block) =>
      block.type === "text"
        ? { type: "text" as const, text: block.text }
        : { type: "image" as const, attachment: { ...block.attachment } },
    ),
    source: {
      kind: "user",
      ...(rpcId !== undefined && rpcId !== "" ? { rpcId } : {}),
    },
  };
}

/**
 * Incremental projector: apply one prompt event → one normalized splice.
 * Callers must feed events in session log order.
 */
export class FaceInboxWireProjector {
  private readonly nextTurn: DshWireUserMessage[] = [];
  private readonly nextStep: DshWireUserMessage[] = [];

  constructor(
    private readonly admitToRpc: ReadonlyMap<string, string> = new Map(),
  ) {}

  /** Project one XRK prompt event into a DSH inbox splice, mutating pending lists. */
  project(event: SessionEvent): DshInboxSplice | undefined {
    switch (event.type) {
      case "prompt/admitted": {
        const target: InboxTarget =
          event.delivery === "steer" ? "next-step" : "next-turn";
        const list = target === "next-step" ? this.nextStep : this.nextTurn;
        const msg = userMessage(
          event.admitId,
          event.content,
          this.admitToRpc.get(event.admitId),
        );
        const start = list.length;
        list.push(msg);
        return { target, start, inserted: [msg] };
      }
      case "prompt/withdrawn": {
        const hit = this.locate(event.admitId);
        if (!hit) return undefined;
        hit.list.splice(hit.index, 1);
        return {
          target: hit.target,
          start: hit.index,
          removedCount: 1,
          inserted: [],
          outcome: "canceled",
        };
      }
      case "prompt/promoted": {
        // Claim-style pure deletion (no outcome) — matches DSH claim splices.
        const hit = this.locate(event.admitId);
        if (!hit) return undefined;
        hit.list.splice(hit.index, 1);
        return {
          target: hit.target,
          start: hit.index,
          removedCount: 1,
          inserted: [],
        };
      }
      default:
        return undefined;
    }
  }

  private locate(
    admitId: string,
  ):
    | { target: InboxTarget; list: DshWireUserMessage[]; index: number }
    | undefined {
    const stepIdx = this.nextStep.findIndex((m) => m.id === admitId);
    if (stepIdx >= 0) {
      return { target: "next-step", list: this.nextStep, index: stepIdx };
    }
    const turnIdx = this.nextTurn.findIndex((m) => m.id === admitId);
    if (turnIdx >= 0) {
      return { target: "next-turn", list: this.nextTurn, index: turnIdx };
    }
    return undefined;
  }
}

/** Per-session projectors for live mux fan-out. */
export class FaceInboxWireMaps {
  private readonly bySession = new Map<string, FaceInboxWireProjector>();

  constructor(private readonly admitToRpc: ReadonlyMap<string, string>) {}

  forSession(sessionId: string): FaceInboxWireProjector {
    let p = this.bySession.get(sessionId);
    if (!p) {
      p = new FaceInboxWireProjector(this.admitToRpc);
      this.bySession.set(sessionId, p);
    }
    return p;
  }

  /** Fresh projector for history rebuild (does not touch live mux state). */
  fresh(): FaceInboxWireProjector {
    return new FaceInboxWireProjector(this.admitToRpc);
  }

  clear(sessionId: string): void {
    this.bySession.delete(sessionId);
  }
}
