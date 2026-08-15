/**
 * Per-session client view: ChunkFold + ProjectionStore + GenerationGuard.
 * Consumes Face mux frames and history baselines.
 */

import { isValidSessionEvent } from "@xrkseek/protocol";
import { ChunkFold } from "./chunk-fold.js";
import { GenerationGuard } from "./generation-guard.js";
import {
  ProjectionStore,
  type ProjectionsBaseline,
} from "./projection-store.js";

export interface FaceHistoryPayload {
  readonly events: readonly {
    readonly event: unknown;
    readonly seq: number;
    readonly view?: unknown;
  }[];
  readonly hasMore?: boolean;
  readonly projections?: ProjectionsBaseline;
}

export interface FaceQueueItemView {
  readonly id: string;
  readonly placement: string;
  readonly content: string;
  readonly rpcId?: string;
}

export type FaceMuxFrame =
  | {
      readonly type: "session/event";
      readonly sessionId: string;
      readonly event: unknown;
      readonly seq: number;
      readonly view?: unknown;
    }
  | {
      readonly type: "session/projection";
      readonly sessionId: string;
      readonly key: string;
      readonly value: unknown;
      readonly seq: number;
    }
  | {
      readonly type: "session/subscribed";
      readonly sessionId: string;
      readonly lastSeq: number;
    }
  | {
      readonly type: "session/queue";
      readonly sessionId: string;
      readonly items: readonly unknown[];
    };

export class FaceSessionView {
  readonly fold = new ChunkFold();
  readonly projections = new ProjectionStore();
  readonly gen = new GenerationGuard();
  private sessionId = "";
  private token = 0;
  private lastSeq = -1;
  private queue: FaceQueueItemView[] = [];
  private readonly listeners = new Set<() => void>();

  get activeSessionId(): string {
    return this.sessionId;
  }

  get generation(): number {
    return this.token;
  }

  get queueItems(): readonly FaceQueueItemView[] {
    return this.queue;
  }

  /** Bind to a session and start a new connection generation. */
  attach(sessionId: string): number {
    this.sessionId = sessionId;
    this.token = this.gen.bump();
    this.fold.reset();
    this.projections.clear();
    this.queue = [];
    this.lastSeq = -1;
    this.emit();
    return this.token;
  }

  /** Optimistic user bubble keyed by Face unary rpcId. */
  noteOptimisticPrompt(rpcId: string, text: string): void {
    if (!this.gen.isCurrent(this.token)) return;
    this.fold.pushOptimisticUser(rpcId, text);
  }

  /** Apply history baseline (events + optional projections + tool views). */
  seedHistory(history: FaceHistoryPayload): void {
    if (!this.gen.isCurrent(this.token)) return;
    this.fold.reset();
    for (const row of history.events) {
      if (isValidSessionEvent(row.event)) {
        this.fold.push(row.event);
        this.applyToolView(row.view);
      }
      if (row.seq > this.lastSeq) this.lastSeq = row.seq;
    }
    if (history.projections) {
      this.projections.seed(history.projections);
    }
    this.emit();
  }

  /** Handle one mux payload frame for the attached session. */
  handleMux(frame: unknown): void {
    if (!this.gen.isCurrent(this.token)) return;
    if (!frame || typeof frame !== "object") return;
    const f = frame as FaceMuxFrame;
    if (!("type" in f) || typeof f.type !== "string") return;

    if (f.type === "session/subscribed") {
      if (f.sessionId !== this.sessionId) return;
      this.lastSeq = f.lastSeq;
      this.projections.truncate(f.lastSeq);
      this.emit();
      return;
    }

    if (f.type === "session/event") {
      if (f.sessionId !== this.sessionId) return;
      if (isValidSessionEvent(f.event)) {
        this.fold.push(f.event);
        this.applyToolView(f.view);
      }
      if (f.seq > this.lastSeq) this.lastSeq = f.seq;
      this.emit();
      return;
    }

    if (f.type === "session/projection") {
      if (f.sessionId !== this.sessionId) return;
      this.projections.apply(f.key, f.value, f.seq);
      if (f.seq > this.lastSeq) this.lastSeq = f.seq;
      this.emit();
      return;
    }

    if (f.type === "session/queue") {
      if (f.sessionId !== this.sessionId) return;
      this.queue = normalizeQueue(f.items);
      this.emit();
    }
  }

  /** Reconnect: bump generation, truncate ghost projections, reset fold. */
  reconnect(): number {
    const token = this.gen.bump();
    this.token = token;
    this.fold.reset();
    this.projections.truncate(this.lastSeq);
    this.queue = [];
    this.emit();
    return token;
  }

  title(): string | null {
    const v = this.projections.get("title");
    return typeof v === "string" ? v : v === null ? null : null;
  }

  listMetadata(): { blank: boolean; lastPromptAt: number | null } | undefined {
    const v = this.projections.get("sessionListMetadata");
    if (!v || typeof v !== "object") return undefined;
    const m = v as { blank?: unknown; lastPromptAt?: unknown };
    if (typeof m.blank !== "boolean") return undefined;
    if (!(m.lastPromptAt === null || typeof m.lastPromptAt === "number")) {
      return undefined;
    }
    return { blank: m.blank, lastPromptAt: m.lastPromptAt };
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private applyToolView(view: unknown): void {
    if (!view || typeof view !== "object") return;
    const v = view as {
      kind?: unknown;
      callId?: unknown;
      preview?: unknown;
      argsPreview?: unknown;
    };
    if (typeof v.callId !== "string") return;
    if (v.kind === "tool-call" && typeof v.argsPreview === "string") {
      this.fold.attachToolView(v.callId, "call", v.argsPreview);
    }
    if (v.kind === "tool-result" && typeof v.preview === "string") {
      this.fold.attachToolView(v.callId, "result", v.preview);
    }
  }

  private emit(): void {
    for (const l of this.listeners) l();
  }
}

function normalizeQueue(items: readonly unknown[]): FaceQueueItemView[] {
  const out: FaceQueueItemView[] = [];
  for (const raw of items) {
    if (!raw || typeof raw !== "object") continue;
    const i = raw as Record<string, unknown>;
    if (typeof i.id !== "string" || typeof i.content !== "string") continue;
    out.push({
      id: i.id,
      placement: typeof i.placement === "string" ? i.placement : "queued",
      content: i.content,
      ...(typeof i.rpcId === "string" ? { rpcId: i.rpcId } : {}),
    });
  }
  return out;
}
