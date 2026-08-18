import { readFileSync } from "node:fs";
import { tryWriteJsonSidecar } from "./json-sidecar.js";

export type SubagentMode = "one-shot" | "continuable";

export interface FaceSubagentLink {
  readonly parentSessionId: string;
  readonly childSessionId: string;
  readonly mode: SubagentMode;
  readonly label: string;
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

  constructor(persistPath?: string) {
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

  hasChildren(sessionId: string): boolean {
    return (this.byParent.get(sessionId)?.length ?? 0) > 0;
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
    };
    const bucket = this.byParent.get(link.parentSessionId) ?? [];
    bucket.push(frozen);
    this.byParent.set(link.parentSessionId, bucket);
    this.byChild.set(link.childSessionId, frozen);
    this.save();
    return frozen;
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
        const mode = row.mode === "one-shot" ? "one-shot" : "continuable";
        const label = String(row.label ?? "").trim() || "subagent";
        if (!parentSessionId || !childSessionId) continue;
        const frozen: FaceSubagentLink = {
          parentSessionId,
          childSessionId,
          mode,
          label,
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
