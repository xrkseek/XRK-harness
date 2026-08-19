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
}

export function workspacesJsonPath(runtime: FaceRuntime): string {
  return path.join(resolveHarnessHome(runtime), "workspaces.json");
}

export function loadWorkspaceDoc(runtime: FaceRuntime): WorkspacePersistDoc | null {
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
    return { order, entries, seq };
  } catch {
    return null;
  }
}

export async function persistWorkspaceDoc(
  runtime: FaceRuntime,
  registry: FaceWorkspaceRegistry,
): Promise<void> {
  const file = workspacesJsonPath(runtime);
  await mkdir(path.dirname(file), { recursive: true });
  const doc = registry.exportState();
  await writeFile(file, `${JSON.stringify(doc, null, 2)}\n`, "utf8");
}

export function hydrateWorkspaceRegistry(
  runtime: FaceRuntime,
  registry: FaceWorkspaceRegistry,
): void {
  const doc = loadWorkspaceDoc(runtime);
  if (doc) registry.importState(doc, runtime.workspaceRoot);
}
