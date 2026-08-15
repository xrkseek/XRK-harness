/**
 * UI trajectory fold over XRK SessionEvent (not DeepSeek StreamChunk).
 * Model-visible truth remains deriveMessages; this is display-only.
 */

import type { SessionEvent } from "@xrkseek/protocol";

export type TrajectoryNode =
  | {
      readonly kind: "user";
      readonly turnId: string;
      readonly content: string;
      readonly rpcId?: string;
      readonly optimistic?: boolean;
    }
  | {
      readonly kind: "assistant";
      readonly turnId: string;
      readonly stepId: string;
      readonly content: string;
      readonly partial?: boolean;
    }
  | {
      readonly kind: "tool";
      readonly turnId: string;
      readonly callId: string;
      readonly name: string;
      readonly phase: "call" | "result";
      readonly detail: string;
      readonly viewPreview?: string;
    }
  | { readonly kind: "notice"; readonly content: string };

export interface ChunkFoldSnapshot {
  readonly nodes: readonly TrajectoryNode[];
  /** Live partial assistant text (cleared on assistant/message). */
  readonly partialText: string;
}

export class ChunkFold {
  private nodes: TrajectoryNode[] = [];
  private partialText = "";
  private partialTurn = "";
  private partialStep = "";
  private readonly listeners = new Set<() => void>();

  push(event: SessionEvent): void {
    switch (event.type) {
      case "user/message":
        this.partialText = "";
        // Drop matching optimistic bubble
        this.nodes = this.nodes.filter(
          (n) =>
            !(
              n.kind === "user" &&
              n.optimistic &&
              event.rpcId !== undefined &&
              n.rpcId === event.rpcId
            ),
        );
        this.nodes.push({
          kind: "user",
          turnId: event.turnId,
          content: event.content,
          ...(event.rpcId !== undefined ? { rpcId: event.rpcId } : {}),
        });
        break;
      case "assistant/chunk":
        this.partialTurn = event.turnId;
        this.partialStep = event.stepId;
        this.partialText += event.text;
        break;
      case "assistant/message":
        this.partialText = "";
        this.nodes.push({
          kind: "assistant",
          turnId: event.turnId,
          stepId: event.stepId,
          content: event.content,
        });
        break;
      case "tool/call":
        this.nodes.push({
          kind: "tool",
          turnId: event.turnId,
          callId: event.call.id,
          name: event.call.name,
          phase: "call",
          detail: JSON.stringify(event.call.arguments ?? {}),
        });
        break;
      case "tool/result":
        this.nodes.push({
          kind: "tool",
          turnId: event.turnId,
          callId: event.result.toolCallId,
          name: event.result.name,
          phase: "result",
          detail: event.result.content,
        });
        break;
      case "safety/notice":
        this.nodes.push({ kind: "notice", content: event.content });
        break;
      default:
        break;
    }
    this.emit();
  }

  /**
   * Optimistic user row until matching `user/message.rpcId` arrives.
   */
  pushOptimisticUser(rpcId: string, content: string): void {
    this.nodes.push({
      kind: "user",
      turnId: `opt:${rpcId}`,
      content,
      rpcId,
      optimistic: true,
    });
    this.emit();
  }

  /** Attach Host tool view preview onto the latest matching tool node. */
  attachToolView(
    callId: string,
    phase: "call" | "result",
    preview: string,
  ): void {
    for (let i = this.nodes.length - 1; i >= 0; i--) {
      const n = this.nodes[i]!;
      if (n.kind === "tool" && n.callId === callId && n.phase === phase) {
        this.nodes[i] = { ...n, viewPreview: preview };
        this.emit();
        return;
      }
    }
  }

  /** Reset on connection generation bump / resync. */
  reset(): void {
    this.nodes = [];
    this.partialText = "";
    this.partialTurn = "";
    this.partialStep = "";
    this.emit();
  }

  getSnapshot(): ChunkFoldSnapshot {
    const nodes = [...this.nodes];
    if (this.partialText) {
      nodes.push({
        kind: "assistant",
        turnId: this.partialTurn,
        stepId: this.partialStep,
        content: this.partialText,
        partial: true,
      });
    }
    return { nodes, partialText: this.partialText };
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit(): void {
    for (const l of this.listeners) l();
  }
}
