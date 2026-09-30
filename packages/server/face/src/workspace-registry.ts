/**
 * Workspace registry for Face (list/create/rename/archive).
 * Persists to `{harnessHome}/workspaces.json` via workspace-store.
 */

import path from "node:path";
import { defaultWorkspaceTitle } from "./workspace-paths.js";

export interface FaceWorkspaceView {
  readonly workspaceId: string;
  readonly path: string;
  title: string;
  readonly sessionIds: string[];
  readonly createdAt: string;
  updatedAt: string;
}

export class FaceWorkspaceRegistry {
  private readonly root: string;
  private readonly workspaces = new Map<string, Omit<FaceWorkspaceView, "sessionIds">>();
  private readonly order: string[] = [];
  private readonly membership = new Map<string, string>();
  /** workspaceId → session ids in sidebar order. */
  private readonly sessionOrder = new Map<string, string[]>();
  private readonly archived = new Set<string>();
  /** Registry-global pin order (newest pin first). Mutually exclusive with archive. */
  private pinned: string[] = [];
  private seq = 0;

  constructor(root: string) {
    const abs = path.resolve(root);
    this.root = abs;
    const id = "ws_default";
    const now = new Date().toISOString();
    this.workspaces.set(id, {
      workspaceId: id,
      path: abs,
      title: defaultWorkspaceTitle(abs),
      createdAt: now,
      updatedAt: now,
    });
    this.order.push(id);
    this.sessionOrder.set(id, []);
  }

  defaultId(): string {
    return "ws_default";
  }

  /** Live (non-archived) workspace owning this session, if any. */
  workspaceIdOf(sessionId: string): string | undefined {
    return this.membership.get(sessionId);
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
  }): { workspaceId?: string; cwd: string } | { error: string } {
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
    const def = this.workspaces.get(this.defaultId());
    if (def) {
      return { workspaceId: def.workspaceId, cwd: def.path };
    }
    // Default registration was removed — cwd-only attach (session stays Ungrouped).
    return { cwd: this.root };
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
      title: defaultWorkspaceTitle(abs),
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

  /**
   * Archive one session into the registry-global set. Membership and sidebar
   * order stay so a later unarchive restores the same workspace slot (dsh
   * parity). Already-archived ids are idempotent. Pin and archive are
   * mutually exclusive — archive drops any pin (DSH parity).
   */
  archiveSession(sessionId: string): { archivedSessionIds: string[]; pinnedSessionIds: string[] } {
    this.archived.add(sessionId);
    this.pinned = this.pinned.filter((id) => id !== sessionId);
    return { archivedSessionIds: [...this.archived], pinnedSessionIds: [...this.pinned] };
  }

  /**
   * Drop one session from the archive set. Accounting was never cleared on
   * archive, so the session reappears in its recorded workspace order. An id
   * that is not archived resolves without writing.
   */
  unarchiveSession(sessionId: string): string[] {
    this.archived.delete(sessionId);
    return [...this.archived];
  }

  /**
   * Drop one session from archive, pin, membership, and every workspace order
   * bucket. Idempotent for an unknown id. Used by durable `session.delete`.
   */
  forgetSession(sessionId: string): {
    archivedSessionIds: string[];
    pinnedSessionIds: string[];
  } {
    this.archived.delete(sessionId);
    this.pinned = this.pinned.filter((id) => id !== sessionId);
    const ws = this.membership.get(sessionId);
    if (ws !== undefined) {
      this.membership.delete(sessionId);
      this.removeFromOrder(ws, sessionId);
      const row = this.workspaces.get(ws);
      if (row) row.updatedAt = new Date().toISOString();
    }
    return {
      archivedSessionIds: [...this.archived],
      pinnedSessionIds: [...this.pinned],
    };
  }

  /** Whether one session sits in the registry-global archive set. */
  isArchived(sessionId: string): boolean {
    return this.archived.has(sessionId);
  }

  /**
   * Pin one session to the front of the registry-global pin order (newest
   * first). Unarchives first when needed so pin and archive stay exclusive.
   */
  pinSession(sessionId: string): { archivedSessionIds: string[]; pinnedSessionIds: string[] } {
    this.archived.delete(sessionId);
    this.pinned = [sessionId, ...this.pinned.filter((id) => id !== sessionId)];
    return { archivedSessionIds: [...this.archived], pinnedSessionIds: [...this.pinned] };
  }

  /**
   * Drop one session from the pin order. Unknown ids resolve without writing.
   */
  unpinSession(sessionId: string): string[] {
    this.pinned = this.pinned.filter((id) => id !== sessionId);
    return [...this.pinned];
  }

  /**
   * Remove one workspace registration (including the bootstrap default).
   * Sessions lose their accounting slot and appear under Ungrouped; logs and
   * directories stay untouched.
   */
  delete(workspaceId: string): { ok: true; movedSessionIds: string[] } | { ok: false; reason: string } {
    if (!this.workspaces.has(workspaceId)) {
      return { ok: false, reason: `unknown workspaceId: ${workspaceId}` };
    }
    const released = new Set<string>(this.sessionOrder.get(workspaceId) ?? []);
    for (const [sid, ws] of this.membership) {
      if (ws === workspaceId) released.add(sid);
    }
    for (const sid of released) {
      this.membership.delete(sid);
      this.removeFromOrder(workspaceId, sid);
    }
    this.workspaces.delete(workspaceId);
    this.sessionOrder.delete(workspaceId);
    const idx = this.order.indexOf(workspaceId);
    if (idx >= 0) this.order.splice(idx, 1);
    return { ok: true, movedSessionIds: [...released] };
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
    const targetWs = this.membership.get(beforeSessionId);
    if (targetWs === undefined || !this.workspaces.has(targetWs)) return undefined;
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
    pinnedSessionIds: string[];
  } {
    const assigned = new Set<string>();
    const byWs = new Map<string, string[]>();
    for (const id of this.order) {
      const ordered = (this.sessionOrder.get(id) ?? []).filter(
        (sid) =>
          allSessionIds.includes(sid) &&
          !this.archived.has(sid) &&
          this.membership.get(sid) === id,
      );
      byWs.set(id, ordered);
      for (const sid of ordered) assigned.add(sid);
    }

    const items = this.order.map((id) => this.view(id, byWs.get(id) ?? [])!);
    return {
      items,
      archivedSessionIds: [...this.archived],
      pinnedSessionIds: this.pinned.filter((sid) => allSessionIds.includes(sid) || this.membership.has(sid)),
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

  exportState(): {
    order: string[];
    entries: Record<
      string,
      { path: string; title: string; createdAt: string; updatedAt: string }
    >;
    seq: number;
    membership: Record<string, string>;
    sessionOrder: Record<string, string[]>;
    archivedSessionIds: string[];
    pinnedSessionIds: string[];
  } {
    const entries: Record<
      string,
      { path: string; title: string; createdAt: string; updatedAt: string }
    > = {};
    for (const [id, row] of this.workspaces) {
      entries[id] = {
        path: row.path,
        title: row.title,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      };
    }
    const membership: Record<string, string> = {};
    for (const [sid, wsId] of this.membership) {
      membership[sid] = wsId;
    }
    const sessionOrder: Record<string, string[]> = {};
    for (const [wsId, ids] of this.sessionOrder) {
      sessionOrder[wsId] = [...ids];
    }
    return {
      order: [...this.order],
      entries,
      seq: this.seq,
      membership,
      sessionOrder,
      archivedSessionIds: [...this.archived],
      pinnedSessionIds: [...this.pinned],
    };
  }

  /** All live session → workspace bindings. */
  listMembership(): readonly (readonly [string, string])[] {
    return [...this.membership.entries()];
  }

  importState(
    doc: {
      order: readonly string[];
      entries: Readonly<
        Record<
          string,
          { path: string; title: string; createdAt: string; updatedAt: string }
        >
      >;
      seq: number;
      membership?: Readonly<Record<string, string>>;
      sessionOrder?: Readonly<Record<string, readonly string[]>>;
      archivedSessionIds?: readonly string[];
      pinnedSessionIds?: readonly string[];
    },
    fallbackRoot: string,
  ): void {
    this.workspaces.clear();
    this.order.length = 0;
    this.sessionOrder.clear();
    this.membership.clear();
    this.archived.clear();
    this.pinned = [];
    this.seq = Math.max(0, doc.seq);

    const root = path.resolve(fallbackRoot);
    const defaultId = "ws_default";
    const now = new Date().toISOString();
    const persistedDefault = doc.entries[defaultId];
    const wantsDefault =
      doc.order.includes(defaultId) ||
      persistedDefault !== undefined ||
      (doc.order.length === 0 && Object.keys(doc.entries).length === 0);
    if (wantsDefault) {
      const row = persistedDefault ?? {
        path: root,
        title: defaultWorkspaceTitle(root),
        createdAt: now,
        updatedAt: now,
      };
      this.workspaces.set(defaultId, {
        workspaceId: defaultId,
        path: path.resolve(row.path),
        title: row.title,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      });
      if (!this.order.includes(defaultId)) this.order.push(defaultId);
      this.sessionOrder.set(defaultId, []);
    }

    for (const id of doc.order) {
      if (id === defaultId) continue;
      const row = doc.entries[id];
      if (!row) continue;
      this.workspaces.set(id, {
        workspaceId: id,
        path: path.resolve(row.path),
        title: row.title,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      });
      if (!this.order.includes(id)) this.order.push(id);
      this.sessionOrder.set(id, []);
    }

    for (const [id, row] of Object.entries(doc.entries)) {
      if (id === defaultId || this.workspaces.has(id)) continue;
      this.workspaces.set(id, {
        workspaceId: id,
        path: path.resolve(row.path),
        title: row.title,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      });
      if (!this.order.includes(id)) this.order.push(id);
      this.sessionOrder.set(id, []);
    }

    if (doc.sessionOrder) {
      for (const [wsId, ids] of Object.entries(doc.sessionOrder)) {
        if (!this.workspaces.has(wsId)) continue;
        const live = ids.filter((sid) => typeof sid === "string" && sid.length > 0);
        this.sessionOrder.set(wsId, [...live]);
      }
    }
    if (doc.membership) {
      for (const [sid, wsId] of Object.entries(doc.membership)) {
        if (!this.workspaces.has(wsId)) continue;
        this.membership.set(sid, wsId);
        const bucket = this.sessionOrder.get(wsId) ?? [];
        if (!bucket.includes(sid)) {
          bucket.push(sid);
          this.sessionOrder.set(wsId, bucket);
        }
      }
    }
    if (doc.archivedSessionIds) {
      for (const sid of doc.archivedSessionIds) {
        if (typeof sid !== "string" || sid.length === 0) continue;
        this.archived.add(sid);
        this.membership.delete(sid);
        for (const wsId of this.order) {
          this.removeFromOrder(wsId, sid);
        }
      }
    }
    if (doc.pinnedSessionIds) {
      const seen = new Set<string>();
      this.pinned = [];
      for (const sid of doc.pinnedSessionIds) {
        if (typeof sid !== "string" || sid.length === 0) continue;
        if (seen.has(sid) || this.archived.has(sid)) continue;
        seen.add(sid);
        this.pinned.push(sid);
      }
    }
  }
}
