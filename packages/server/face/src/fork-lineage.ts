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
          this.byChild.set(row.childSessionId, {
            parentSessionId: row.parentSessionId,
            childSessionId: row.childSessionId,
          });
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

  attach(link: FaceForkLink): FaceForkLink {
    const existing = this.byChild.get(link.childSessionId);
    if (existing) return existing;
    const frozen: FaceForkLink = {
      parentSessionId: link.parentSessionId,
      childSessionId: link.childSessionId,
    };
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
