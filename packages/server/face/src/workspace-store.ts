/**
 * Durable workspace registry under `{harnessHome}/workspaces.json`.
 */
import { readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { FaceRuntime } from "./context.js";
import type { FaceWorkspaceRegistry } from "./workspace-registry.js";
import { resolveHarnessHome } from "./settings-document.js";

export interface WorkspacePersistEntry {
  readonly path: string;
  readonly title: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface WorkspacePersistDoc {
  readonly order: readonly string[];
  readonly entries: Readonly<Record<string, WorkspacePersistEntry>>;
  readonly seq: number;
  /** Durable session → workspace binding (survives Host restart). */
  readonly membership?: Readonly<Record<string, string>>;
  /** Sidebar session order per workspace. */
  readonly sessionOrder?: Readonly<Record<string, readonly string[]>>;
  /** Registry-global archive set (hidden from grouping surfaces). */
  readonly archivedSessionIds?: readonly string[];
}

export function workspacesJsonPath(runtime: FaceRuntime): string {
  return path.join(resolveHarnessHome(runtime), "workspaces.json");
}

/**
 * Durable workspaces.json only when Face has an explicit harness home
 * (`productDir`, as Host sets) — never invent writes into ambient `~/.xrk`
 * from Face unit tests that omit isolation.
 */
function durableWorkspaceHome(runtime: FaceRuntime): boolean {
  return Boolean(runtime.productDir?.trim());
}

export function loadWorkspaceDoc(runtime: FaceRuntime): WorkspacePersistDoc | null {
  if (!durableWorkspaceHome(runtime)) return null;
  try {
    const raw = readFileSync(workspacesJsonPath(runtime), "utf8").replace(/^\uFEFF/, "");
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const doc = parsed as Record<string, unknown>;
    const order = Array.isArray(doc.order)
      ? doc.order.filter((id): id is string => typeof id === "string")
      : [];
    const entriesRaw = doc.entries;
    const entries: Record<string, WorkspacePersistEntry> = {};
    if (entriesRaw && typeof entriesRaw === "object" && !Array.isArray(entriesRaw)) {
      for (const [id, row] of Object.entries(entriesRaw)) {
        if (!row || typeof row !== "object" || Array.isArray(row)) continue;
        const pathVal = String((row as { path?: unknown }).path ?? "").trim();
        if (!pathVal) continue;
        entries[id] = {
          path: pathVal,
          title: String((row as { title?: unknown }).title ?? path.basename(pathVal)),
          createdAt: String((row as { createdAt?: unknown }).createdAt ?? new Date().toISOString()),
          updatedAt: String((row as { updatedAt?: unknown }).updatedAt ?? new Date().toISOString()),
        };
      }
    }
    const seq =
      typeof doc.seq === "number" && Number.isFinite(doc.seq)
        ? Math.max(0, Math.floor(doc.seq))
        : 0;
    const membership: Record<string, string> = {};
    if (doc.membership && typeof doc.membership === "object" && !Array.isArray(doc.membership)) {
      for (const [sid, wsId] of Object.entries(doc.membership)) {
        if (typeof wsId === "string" && wsId.trim()) membership[sid] = wsId.trim();
      }
    }
    const sessionOrder: Record<string, string[]> = {};
    if (doc.sessionOrder && typeof doc.sessionOrder === "object" && !Array.isArray(doc.sessionOrder)) {
      for (const [wsId, ids] of Object.entries(doc.sessionOrder)) {
        if (!Array.isArray(ids)) continue;
        sessionOrder[wsId] = ids.filter((id): id is string => typeof id === "string");
      }
    }
    const archivedSessionIds = Array.isArray(doc.archivedSessionIds)
      ? doc.archivedSessionIds.filter((id): id is string => typeof id === "string" && id.length > 0)
      : [];
    return {
      order,
      entries,
      seq,
      ...(Object.keys(membership).length ? { membership } : {}),
      ...(Object.keys(sessionOrder).length ? { sessionOrder } : {}),
      ...(archivedSessionIds.length ? { archivedSessionIds } : {}),
    };
  } catch {
    return null;
  }
}

export async function persistWorkspaceDoc(
  runtime: FaceRuntime,
  registry: FaceWorkspaceRegistry,
): Promise<void> {
  if (!durableWorkspaceHome(runtime)) return;
  const file = workspacesJsonPath(runtime);
  await mkdir(path.dirname(file), { recursive: true });
  const doc = registry.exportState();
  await writeFile(file, `${JSON.stringify(doc, null, 2)}\n`, "utf8");
}

export function hydrateWorkspaceRegistry(
  runtime: FaceRuntime,
  registry: FaceWorkspaceRegistry,
): void {
  if (!durableWorkspaceHome(runtime)) return;
  const doc = loadWorkspaceDoc(runtime);
  if (doc) registry.importState(doc, runtime.workspaceRoot);
  // Rebuild in-memory sessionCwds from durable membership so list/agent
  // do not fall back to serve workspaceRoot (often the wrong project).
  for (const [sessionId, workspaceId] of registry.listMembership()) {
    const row = registry.get(workspaceId);
    if (row) runtime.sessionCwds.set(sessionId, path.resolve(row.path));
  }
}
