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
  /** workspaceId → session ids in sidebar order. */
  private readonly sessionOrder = new Map<string, string[]>();
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
    this.sessionOrder.set(id, []);
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
    const prev = this.membership.get(sessionId);
    if (prev && prev !== workspaceId) {
      this.removeFromOrder(prev, sessionId);
    }
    this.membership.set(sessionId, workspaceId);
    const bucket = this.sessionOrder.get(workspaceId) ?? [];
    if (!bucket.includes(sessionId)) {
      bucket.push(sessionId);
      this.sessionOrder.set(workspaceId, bucket);
    }
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
    this.sessionOrder.set(id, []);
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
    const ws = this.membership.get(sessionId);
    if (ws) this.removeFromOrder(ws, sessionId);
    this.membership.delete(sessionId);
    return [...this.archived];
  }

  /**
   * Remove a non-default workspace. Sessions move to the default workspace.
   */
  delete(workspaceId: string): { ok: true; movedSessionIds: string[] } | { ok: false; reason: string } {
    if (workspaceId === this.defaultId()) {
      return { ok: false, reason: "cannot delete default workspace" };
    }
    if (!this.workspaces.has(workspaceId)) {
      return { ok: false, reason: `unknown workspaceId: ${workspaceId}` };
    }
    const moved = [...(this.sessionOrder.get(workspaceId) ?? [])];
    const def = this.defaultId();
    for (const sid of moved) {
      this.attachSession(sid, def);
    }
    this.workspaces.delete(workspaceId);
    this.sessionOrder.delete(workspaceId);
    const idx = this.order.indexOf(workspaceId);
    if (idx >= 0) this.order.splice(idx, 1);
    return { ok: true, movedSessionIds: moved };
  }

  /** Reorder workspaces so `workspaceId` sits immediately before `beforeId`. */
  insertBefore(
    workspaceId: string,
    beforeId: string,
  ): FaceWorkspaceView[] | undefined {
    if (!this.workspaces.has(workspaceId) || !this.workspaces.has(beforeId)) {
      return undefined;
    }
    if (workspaceId === beforeId) {
      return this.order.map((id) => this.view(id)!);
    }
    const from = this.order.indexOf(workspaceId);
    this.order.splice(from, 1);
    const to = this.order.indexOf(beforeId);
    if (to < 0) {
      this.order.push(workspaceId);
    } else {
      this.order.splice(to, 0, workspaceId);
    }
    return this.order.map((id) => this.view(id)!);
  }

  /**
   * Reorder (and optionally move) a session so it sits before `beforeSessionId`.
   * Both must be live (not archived).
   */
  insertSessionBefore(
    sessionId: string,
    beforeSessionId: string,
  ): FaceWorkspaceView | undefined {
    if (this.archived.has(sessionId) || this.archived.has(beforeSessionId)) {
      return undefined;
    }
    const targetWs =
      this.membership.get(beforeSessionId) ?? this.defaultId();
    if (!this.workspaces.has(targetWs)) return undefined;
    this.attachSession(sessionId, targetWs);
    const bucket = this.sessionOrder.get(targetWs) ?? [];
    const from = bucket.indexOf(sessionId);
    if (from >= 0) bucket.splice(from, 1);
    const to = bucket.indexOf(beforeSessionId);
    if (to < 0) bucket.push(sessionId);
    else bucket.splice(to, 0, sessionId);
    this.sessionOrder.set(targetWs, bucket);
    const row = this.workspaces.get(targetWs)!;
    row.updatedAt = new Date().toISOString();
    return this.view(targetWs);
  }

  list(allSessionIds: readonly string[]): {
    items: FaceWorkspaceView[];
    archivedSessionIds: string[];
  } {
    const assigned = new Set<string>();
    const byWs = new Map<string, string[]>();
    for (const id of this.order) {
      const ordered = (this.sessionOrder.get(id) ?? []).filter(
        (sid) =>
          allSessionIds.includes(sid) &&
          !this.archived.has(sid) &&
          (this.membership.get(sid) ?? this.defaultId()) === id,
      );
      byWs.set(id, ordered);
      for (const sid of ordered) assigned.add(sid);
    }

    const def = this.defaultId();
    const orphanBucket = byWs.get(def) ?? [];
    for (const sessionId of allSessionIds) {
      if (this.archived.has(sessionId) || assigned.has(sessionId)) continue;
      orphanBucket.push(sessionId);
    }
    byWs.set(def, orphanBucket);
    this.sessionOrder.set(def, orphanBucket);

    const items = this.order.map((id) => this.view(id, byWs.get(id) ?? [])!);
    return {
      items,
      archivedSessionIds: [...this.archived],
    };
  }

  private removeFromOrder(workspaceId: string, sessionId: string): void {
    const bucket = this.sessionOrder.get(workspaceId);
    if (!bucket) return;
    const idx = bucket.indexOf(sessionId);
    if (idx >= 0) bucket.splice(idx, 1);
  }

  private view(
    workspaceId: string,
    sessionIds?: string[],
  ): FaceWorkspaceView | undefined {
    const row = this.workspaces.get(workspaceId);
    if (!row) return undefined;
    const ids =
      sessionIds ??
      (this.sessionOrder.get(workspaceId) ?? []).filter(
        (sid) => !this.archived.has(sid),
      );
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
