/**
 * In-memory DeepSeek workspace registry for Face (list/create/rename/archive).
 * Not durable across process restart — enough for DSH Web sidebar wiring.
 */

import path from "node:path";

export interface FaceWorkspaceView {
  readonly workspaceId: string;
  readonly path: string;
  title: string;
  readonly sessionIds: string[];
  readonly createdAt: string;
  updatedAt: string;
}

export class FaceWorkspaceRegistry {
  private readonly workspaces = new Map<string, Omit<FaceWorkspaceView, "sessionIds">>();
  private readonly order: string[] = [];
  private readonly membership = new Map<string, string>();
  private readonly archived = new Set<string>();
  private seq = 0;

  constructor(root: string) {
    const abs = path.resolve(root);
    const id = "ws_default";
    const now = new Date().toISOString();
    this.workspaces.set(id, {
      workspaceId: id,
      path: abs,
      title: path.basename(abs) || "workspace",
      createdAt: now,
      updatedAt: now,
    });
    this.order.push(id);
  }

  defaultId(): string {
    return "ws_default";
  }

  get(workspaceId: string): Omit<FaceWorkspaceView, "sessionIds"> | undefined {
    return this.workspaces.get(workspaceId);
  }

  findByPath(absPath: string): Omit<FaceWorkspaceView, "sessionIds"> | undefined {
    const want = path.resolve(absPath);
    for (const row of this.workspaces.values()) {
      if (path.resolve(row.path) === want) return row;
    }
    return undefined;
  }

  attachSession(sessionId: string, workspaceId: string): FaceWorkspaceView | undefined {
    if (!this.workspaces.has(workspaceId)) return undefined;
    this.membership.set(sessionId, workspaceId);
    const row = this.workspaces.get(workspaceId)!;
    row.updatedAt = new Date().toISOString();
    return this.view(workspaceId);
  }

  /** Resolve workspaceId or adopt/create by cwd path. */
  resolveAttachTarget(opts: {
    workspaceId?: string;
    cwd?: string;
  }): { workspaceId: string; cwd: string } | { error: string } {
    if (opts.workspaceId && opts.cwd) {
      return { error: "workspaceId or cwd, not both" };
    }
    if (opts.workspaceId) {
      const row = this.workspaces.get(opts.workspaceId);
      if (!row) return { error: `unknown workspaceId: ${opts.workspaceId}` };
      return { workspaceId: row.workspaceId, cwd: row.path };
    }
    if (opts.cwd) {
      const abs = path.resolve(opts.cwd);
      const existing = this.findByPath(abs);
      if (existing) {
        return { workspaceId: existing.workspaceId, cwd: existing.path };
      }
      const created = this.create(abs);
      return { workspaceId: created.workspace.workspaceId, cwd: created.workspace.path };
    }
    const def = this.workspaces.get(this.defaultId())!;
    return { workspaceId: def.workspaceId, cwd: def.path };
  }

  create(absPath: string): { workspace: FaceWorkspaceView; created: boolean } {
    const abs = path.resolve(absPath);
    const existing = this.findByPath(abs);
    if (existing) {
      return { workspace: this.view(existing.workspaceId)!, created: false };
    }
    this.seq += 1;
    const id = `ws_${this.seq}`;
    const now = new Date().toISOString();
    this.workspaces.set(id, {
      workspaceId: id,
      path: abs,
      title: path.basename(abs) || "workspace",
      createdAt: now,
      updatedAt: now,
    });
    this.order.push(id);
    return { workspace: this.view(id)!, created: true };
  }

  rename(workspaceId: string, title: string): FaceWorkspaceView | undefined {
    const row = this.workspaces.get(workspaceId);
    if (!row) return undefined;
    const trimmed = title.trim();
    if (!trimmed) return undefined;
    row.title = trimmed;
    row.updatedAt = new Date().toISOString();
    return this.view(workspaceId);
  }

  archiveSession(sessionId: string): string[] {
    this.archived.add(sessionId);
    this.membership.delete(sessionId);
    return [...this.archived];
  }

  list(allSessionIds: readonly string[]): {
    items: FaceWorkspaceView[];
    archivedSessionIds: string[];
  } {
    const assigned = new Set<string>();
    const byWs = new Map<string, string[]>();
    for (const id of this.order) byWs.set(id, []);

    for (const [sessionId, workspaceId] of this.membership) {
      if (this.archived.has(sessionId)) continue;
      if (!allSessionIds.includes(sessionId)) continue;
      const bucket = byWs.get(workspaceId);
      if (!bucket) continue;
      bucket.push(sessionId);
      assigned.add(sessionId);
    }

    const def = this.defaultId();
    const orphanBucket = byWs.get(def) ?? [];
    for (const sessionId of allSessionIds) {
      if (this.archived.has(sessionId) || assigned.has(sessionId)) continue;
      orphanBucket.push(sessionId);
    }
    byWs.set(def, orphanBucket);

    const items = this.order.map((id) => this.view(id, byWs.get(id) ?? [])!);
    return {
      items,
      archivedSessionIds: [...this.archived],
    };
  }

  private view(
    workspaceId: string,
    sessionIds?: string[],
  ): FaceWorkspaceView | undefined {
    const row = this.workspaces.get(workspaceId);
    if (!row) return undefined;
    const ids =
      sessionIds ??
      [...this.membership.entries()]
        .filter(
          ([sid, wid]) => wid === workspaceId && !this.archived.has(sid),
        )
        .map(([sid]) => sid);
    return {
      workspaceId: row.workspaceId,
      path: row.path,
      title: row.title,
      sessionIds: ids,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
