/**
 * Top-level identity sessions: main Agent = a roster 干员 (not a subagent child).
 * Persists `{harnessHome}/session-identities.json`.
 */
import { readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { tryWriteJsonSidecar } from "./json-sidecar.js";

export interface SessionIdentityBinding {
  readonly sessionId: string;
  readonly memberId: string;
  readonly workspaceId: string;
}

type PersistShape = {
  readonly version: 1;
  readonly bindings: SessionIdentityBinding[];
};

export class FaceSessionIdentityStore {
  private readonly bySession = new Map<string, SessionIdentityBinding>();
  private readonly persistPath: string | undefined;

  constructor(persistPath?: string) {
    this.persistPath = persistPath;
    if (persistPath) this.load();
  }

  get(sessionId: string): SessionIdentityBinding | undefined {
    return this.bySession.get(sessionId);
  }

  bind(binding: SessionIdentityBinding): void {
    const sessionId = binding.sessionId.trim();
    const memberId = binding.memberId.trim();
    const workspaceId = binding.workspaceId.trim();
    if (!sessionId || !memberId || !workspaceId) return;
    this.bySession.set(sessionId, { sessionId, memberId, workspaceId });
    this.save();
  }

  forget(sessionId: string): void {
    if (!this.bySession.delete(sessionId)) return;
    this.save();
  }

  list(): readonly SessionIdentityBinding[] {
    return [...this.bySession.values()];
  }

  private load(): void {
    const file = this.persistPath;
    if (!file) return;
    try {
      const raw = readFileSync(file, "utf8").replace(/^\uFEFF/, "");
      const doc = JSON.parse(raw) as PersistShape;
      if (!doc || doc.version !== 1 || !Array.isArray(doc.bindings)) return;
      for (const row of doc.bindings) {
        if (!row || typeof row !== "object") continue;
        const sessionId = String(row.sessionId ?? "").trim();
        const memberId = String(row.memberId ?? "").trim();
        const workspaceId = String(row.workspaceId ?? "").trim();
        if (!sessionId || !memberId || !workspaceId) continue;
        this.bySession.set(sessionId, { sessionId, memberId, workspaceId });
      }
    } catch {
      /* missing / corrupt — empty */
    }
  }

  private save(): void {
    const file = this.persistPath;
    if (!file) return;
    const doc: PersistShape = {
      version: 1,
      bindings: this.list().map((b) => ({ ...b })),
    };
    tryWriteJsonSidecar(file, doc);
  }
}

export function sessionIdentitiesPath(productHome: string): string {
  return path.join(path.resolve(productHome), "session-identities.json");
}

/** Async mkdir helper for Hosts that prefer await before first write. */
export async function ensureSessionIdentitiesDir(
  productHome: string,
): Promise<string> {
  const file = sessionIdentitiesPath(productHome);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, "", { flag: "a" });
  return file;
}
