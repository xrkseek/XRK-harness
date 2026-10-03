import { readFileSync } from "node:fs";
import { tryWriteJsonSidecar } from "./json-sidecar.js";

export type SubagentMode = "one-shot" | "continuable" | "fork";

/**
 * Child-owned events: everything at or after the fork seed boundary.
 * Readers that surface a child's answer must use this (or an explicit
 * slice) — a seeded child's log *starts with* the parent's transcript, so a
 * naive last-assistant-text scan returns the parent's own last reply.
 */
export function subagentOwnedEvents<T>(
  link: Pick<FaceSubagentLink, "seedEventCount"> | undefined,
  events: readonly T[],
): readonly T[] {
  const cut = link?.seedEventCount;
  if (cut === undefined || cut <= 0) return events;
  return cut >= events.length ? [] : events.slice(cut);
}

export interface FaceSubagentLink {
  readonly parentSessionId: string;
  readonly childSessionId: string;
  readonly mode: SubagentMode;
  readonly label: string;
  /**
   * Durable event-log boundary for seeded (inherit_context) children: the
   * count of events copied from the parent at fork time. Child-owned events
   * start at this index, so answer extraction must slice from here —
   * otherwise the parent's own last assistant text is mistaken for the
   * child's answer. Omitted / 0 = no seed (fresh child).
   */
  readonly seedEventCount?: number;
}

type PersistShape = {
  readonly links: FaceSubagentLink[];
};

/**
 * Parent → direct children. Optional JSON sidecar for JSONL session dir.
 * Does not invent session events.
 */
export class FaceSubagentRegistry {
  private readonly byParent = new Map<string, FaceSubagentLink[]>();
  private readonly byChild = new Map<string, FaceSubagentLink>();
  private readonly persistPath: string | undefined;

  constructor(
    persistPath?: string,
    private readonly hooks?: {
      onAttach?: (link: FaceSubagentLink) => void;
      /** Observe-only: child stretch idle / one-shot settle (shell SubagentStop). */
      onStop?: (link: FaceSubagentLink) => void;
    },
  ) {
    this.persistPath = persistPath;
    if (persistPath) this.load();
  }

  getByChild(childSessionId: string): FaceSubagentLink | undefined {
    return this.byChild.get(childSessionId);
  }

  get(
    parentSessionId: string,
    childSessionId: string,
  ): FaceSubagentLink | undefined {
    const link = this.byChild.get(childSessionId);
    if (!link || link.parentSessionId !== parentSessionId) return undefined;
    return link;
  }

  list(parentSessionId: string): readonly FaceSubagentLink[] {
    return this.byParent.get(parentSessionId) ?? [];
  }

  entries(): readonly FaceSubagentLink[] {
    return [...this.byChild.values()];
  }

  /** Tool-delegated children only (excludes UI/rewind `fork` lineage). */
  listDelegated(parentSessionId: string): readonly FaceSubagentLink[] {
    return this.list(parentSessionId).filter((link) => link.mode !== "fork");
  }

  hasChildren(sessionId: string): boolean {
    return (this.byParent.get(sessionId)?.length ?? 0) > 0;
  }

  hasDelegatedChildren(sessionId: string): boolean {
    return this.listDelegated(sessionId).length > 0;
  }

  attach(link: FaceSubagentLink): FaceSubagentLink {
    const existing = this.byChild.get(link.childSessionId);
    if (existing) {
      if (existing.parentSessionId !== link.parentSessionId) {
        throw new Error(
          `child already attached to ${existing.parentSessionId}`,
        );
      }
      return existing;
    }
    const frozen: FaceSubagentLink = {
      parentSessionId: link.parentSessionId,
      childSessionId: link.childSessionId,
      mode: link.mode,
      label: link.label,
      ...(typeof link.seedEventCount === "number" &&
      Number.isSafeInteger(link.seedEventCount) &&
      link.seedEventCount > 0
        ? { seedEventCount: link.seedEventCount }
        : {}),
    };
    const bucket = this.byParent.get(link.parentSessionId) ?? [];
    bucket.push(frozen);
    this.byParent.set(link.parentSessionId, bucket);
    this.byChild.set(link.childSessionId, frozen);
    this.save();
    this.hooks?.onAttach?.(frozen);
    return frozen;
  }

  /**
   * Record the fork seed boundary after the child exists. `session.create`
   * attaches before the count is known (a fork child is created by
   * `session.fork`), so this fills the one field `attach` could not.
   */
  setSeedEventCount(
    childSessionId: string,
    seedEventCount: number,
  ): FaceSubagentLink | undefined {
    const link = this.byChild.get(childSessionId);
    if (!link) return undefined;
    if (!Number.isSafeInteger(seedEventCount) || seedEventCount <= 0) return link;
    if (link.seedEventCount === seedEventCount) return link;
    const next: FaceSubagentLink = { ...link, seedEventCount };
    this.byChild.set(childSessionId, next);
    const bucket = this.byParent.get(link.parentSessionId) ?? [];
    const at = bucket.findIndex((l) => l.childSessionId === childSessionId);
    if (at >= 0) bucket[at] = next;
    this.byParent.set(link.parentSessionId, bucket);
    this.save();
    return next;
  }

  /**
   * Drop one link. Returns true when something was removed. Used when a spawn
   * fails after `session.create` (the link is durable but the child is a
   * dead shell), so a failed attempt never leaves an orphan in the catalog.
   */
  detach(childSessionId: string): boolean {
    const link = this.byChild.get(childSessionId);
    if (!link) return false;
    this.byChild.delete(childSessionId);
    const bucket = this.byParent.get(link.parentSessionId);
    if (bucket) {
      const at = bucket.findIndex((l) => l.childSessionId === childSessionId);
      if (at >= 0) bucket.splice(at, 1);
      if (bucket.length === 0) this.byParent.delete(link.parentSessionId);
      else this.byParent.set(link.parentSessionId, bucket);
    }
    this.save();
    return true;
  }

  /** Fire SubagentStop observers (idempotent callers should gate themselves). */
  notifyStop(link: FaceSubagentLink): void {
    this.hooks?.onStop?.(link);
  }

  private load(): void {
    const file = this.persistPath;
    if (!file) return;
    try {
      const raw = JSON.parse(readFileSync(file, "utf8")) as PersistShape;
      if (!Array.isArray(raw.links)) return;
      for (const row of raw.links) {
        if (!row || typeof row !== "object") continue;
        const parentSessionId = String(row.parentSessionId ?? "").trim();
        const childSessionId = String(row.childSessionId ?? "").trim();
        const mode: SubagentMode =
          row.mode === "one-shot"
            ? "one-shot"
            : row.mode === "fork"
              ? "fork"
              : "continuable";
        const label =
          String(row.label ?? "").trim() ||
          (mode === "fork" ? "fork" : "subagent");
        if (!parentSessionId || !childSessionId) continue;
        const seedEventCount =
          typeof row.seedEventCount === "number" &&
          Number.isSafeInteger(row.seedEventCount) &&
          row.seedEventCount > 0
            ? row.seedEventCount
            : undefined;
        const frozen: FaceSubagentLink = {
          parentSessionId,
          childSessionId,
          mode,
          label,
          ...(seedEventCount !== undefined ? { seedEventCount } : {}),
        };
        const bucket = this.byParent.get(parentSessionId) ?? [];
        bucket.push(frozen);
        this.byParent.set(parentSessionId, bucket);
        this.byChild.set(childSessionId, frozen);
      }
    } catch {
      /* missing / corrupt sidecar → empty registry */
    }
  }

  private save(): void {
    const file = this.persistPath;
    if (!file) return;
    tryWriteJsonSidecar(file, { links: [...this.byChild.values()] });
  }
}
