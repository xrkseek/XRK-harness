/**
 * Curated-memory directory layout — one MemoryProvider shape, many zones.
 *
 * Layout under `{XRK_HOME}/memories`:
 * - (root)              global / home-wide MEMORY.md · USER.md
 * - workspaces/{wsId}/  workspace zone
 * - sessions/{sid}/     main-session zone
 * - agents/{agentId}/   roster member / 干员 zone
 */
import path from "node:path";
import { resolveXrkHome } from "@xrkseek/xrk-home-paths";
import { defaultCuratedMemoryDir } from "./store.js";

export type CuratedMemoryScopeKind =
  | "global"
  | "workspace"
  | "session"
  | "agent";

export const CURATED_MEMORY_SCOPE_KINDS: readonly CuratedMemoryScopeKind[] = [
  "global",
  "workspace",
  "session",
  "agent",
] as const;

function safeSegment(raw: string, fallback: string): string {
  const t = raw.trim().replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 120);
  return t || fallback;
}

export interface CuratedMemoryScopeIds {
  readonly workspaceId?: string;
  readonly sessionId?: string;
  /** Roster member id or spawn role key for a 干员. */
  readonly agentId?: string;
  readonly env?: NodeJS.ProcessEnv;
}

/** Resolve the on-disk directory for one memory zone. */
export function curatedMemoryDirFor(
  scope: CuratedMemoryScopeKind,
  ids: CuratedMemoryScopeIds = {},
): string {
  const root = defaultCuratedMemoryDir(ids.env ?? process.env);
  switch (scope) {
    case "global":
      return root;
    case "workspace": {
      const id = safeSegment(ids.workspaceId ?? "", "ws");
      return path.join(root, "workspaces", id);
    }
    case "session": {
      const id = safeSegment(ids.sessionId ?? "", "session");
      return path.join(root, "sessions", id);
    }
    case "agent": {
      const id = safeSegment(ids.agentId ?? "", "agent");
      return path.join(root, "agents", id);
    }
    default:
      return root;
  }
}

/** True when the scope has the ids it needs to open a distinct directory. */
export function canOpenCuratedMemoryScope(
  scope: CuratedMemoryScopeKind,
  ids: CuratedMemoryScopeIds,
): boolean {
  if (scope === "global") return true;
  if (scope === "workspace") return Boolean(ids.workspaceId?.trim());
  if (scope === "session") return Boolean(ids.sessionId?.trim());
  if (scope === "agent") return Boolean(ids.agentId?.trim());
  return false;
}

/** Home root used by path helpers (tests). */
export function curatedMemoryHome(env: NodeJS.ProcessEnv = process.env): string {
  return resolveXrkHome(env);
}
