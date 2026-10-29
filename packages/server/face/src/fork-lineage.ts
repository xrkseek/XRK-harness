/**
 * UI/exploratory fork parent→child links. Not the subagent/delegation graph.
 * Session list uses this for `origin: "fork"` + `parentSessionId`.
 */
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { resolveXrkHome } from "@xrkseek/server-config";
import { tryWriteJsonSidecar } from "./json-sidecar.js";

export interface FaceForkLink {
  readonly parentSessionId: string;
  readonly childSessionId: string;
  /**
   * 1-based Face seq the fork was cut at (`session.fork` `atSeq`), when known.
   * Omitted for whole-log forks / legacy sidecar rows.
   */
  readonly atSeq?: number;
}

type PersistShape = {
  readonly version: 1;
  readonly links: FaceForkLink[];
};

function defaultPath(productHome?: string): string {
  return path.join(
    path.resolve(productHome ?? resolveXrkHome()),
    "fork-lineage.json",
  );
}

function freezeLink(link: FaceForkLink): FaceForkLink {
  const atSeq =
    typeof link.atSeq === "number" &&
    Number.isSafeInteger(link.atSeq) &&
    link.atSeq >= 1
      ? link.atSeq
      : undefined;
  return {
    parentSessionId: link.parentSessionId,
    childSessionId: link.childSessionId,
    ...(atSeq !== undefined ? { atSeq } : {}),
  };
}

export class FaceForkLineageStore {
  private readonly file: string;
  private readonly byChild = new Map<string, FaceForkLink>();

  constructor(persistPath?: string) {
    this.file = persistPath ?? defaultPath();
    this.load();
  }

  private load(): void {
    if (!existsSync(this.file)) return;
    try {
      const parsed = JSON.parse(readFileSync(this.file, "utf8")) as PersistShape;
      if (!parsed || !Array.isArray(parsed.links)) return;
      for (const row of parsed.links) {
        if (
          typeof row?.parentSessionId === "string" &&
          typeof row?.childSessionId === "string" &&
          row.parentSessionId &&
          row.childSessionId
        ) {
          this.byChild.set(row.childSessionId, freezeLink(row));
        }
      }
    } catch {
      // Fail closed: empty registry.
    }
  }

  private save(): void {
    const dir = path.dirname(this.file);
    mkdirSync(dir, { recursive: true });
    const doc: PersistShape = {
      version: 1,
      links: [...this.byChild.values()],
    };
    tryWriteJsonSidecar(this.file, doc);
  }

  getByChild(childSessionId: string): FaceForkLink | undefined {
    return this.byChild.get(childSessionId);
  }

  /** Children whose fork parent is `parentSessionId` (UI fork graph). */
  listByParent(parentSessionId: string): readonly FaceForkLink[] {
    const out: FaceForkLink[] = [];
    for (const link of this.byChild.values()) {
      if (link.parentSessionId === parentSessionId) out.push(link);
    }
    return out;
  }

  attach(link: FaceForkLink): FaceForkLink {
    const existing = this.byChild.get(link.childSessionId);
    if (existing) return existing;
    const frozen = freezeLink(link);
    this.byChild.set(link.childSessionId, frozen);
    this.save();
    return frozen;
  }

  detach(childSessionId: string): boolean {
    if (!this.byChild.delete(childSessionId)) return false;
    this.save();
    return true;
  }
}
