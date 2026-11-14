/**
 * workspace_list discovery: default = recent/active only; AI can opt into
 * dormant rows via includeInactive / query. Tunables live in Settings
 * `workspace-discovery`.
 * 中文。 / English.
 */

import type { FaceRuntime } from "./context.js";
import {
  isAgentHomeSession,
  isAgentHomeWorkspace,
  isXiangyangSession,
} from "./agent-home-boundary.js";
import { IM_WORKSPACE_ID } from "./im-workspace.js";
import { XIANGYANG_WORKSPACE_ID } from "./xiangyang-workspace.js";

/** Defaults mirrored in settings-schemas `workspace-discovery` base. */
export const WORKSPACE_DISCOVERY_DEFAULTS = {
  activeWindowHours: 168,
  maxActiveItems: 16,
  maxListItems: 40,
} as const;

export type WorkspaceDiscoverySettings = {
  readonly activeWindowHours: number;
  readonly maxActiveItems: number;
  readonly maxListItems: number;
};

/** Wire row for workspace_list — no lastActiveAt (sort-only, not model-facing). */
export type WorkspaceListRow = {
  readonly workspaceId: string;
  readonly title: string;
  readonly path: string;
  readonly sessionCount: number;
  /** Present only when false (dormant) so active-default lists stay thin. */
  readonly active?: boolean;
  readonly member?: string | null;
  readonly im?: true;
  readonly xiangyang?: true;
};

export type WorkspaceListQuery = {
  /** Include dormant workspaces (default false). */
  readonly includeInactive?: boolean;
  /** Substring match on id / title / path — also surfaces dormant hits. */
  readonly query?: string;
  /** Soft cap for this call (clamped by settings maxListItems). */
  readonly limit?: number;
};

type ScoredWorkspace = WorkspaceListRow & {
  readonly active: boolean;
  readonly lastActiveAt: number;
};

export function readWorkspaceDiscoverySettings(
  runtime: FaceRuntime,
): WorkspaceDiscoverySettings {
  const raw = runtime.settingsNamespaces.view("workspace-discovery")
    .value as Record<string, unknown>;
  const hours = Number(raw.activeWindowHours);
  const maxActive = Number(raw.maxActiveItems);
  const maxList = Number(raw.maxListItems);
  return {
    activeWindowHours:
      Number.isFinite(hours) && hours >= 1
        ? Math.min(8760, Math.floor(hours))
        : WORKSPACE_DISCOVERY_DEFAULTS.activeWindowHours,
    maxActiveItems:
      Number.isFinite(maxActive) && maxActive >= 1
        ? Math.min(100, Math.floor(maxActive))
        : WORKSPACE_DISCOVERY_DEFAULTS.maxActiveItems,
    maxListItems:
      Number.isFinite(maxList) && maxList >= 1
        ? Math.min(200, Math.floor(maxList))
        : WORKSPACE_DISCOVERY_DEFAULTS.maxListItems,
  };
}

function laneAllows(
  runtime: FaceRuntime,
  sessionId: string,
  workspaceId: string,
  kind: string | undefined,
): boolean {
  const fromHome = isAgentHomeSession(runtime, sessionId);
  const fromXy = isXiangyangSession(runtime, sessionId);
  if (fromHome) {
    return (
      kind === "agent-home"
      || workspaceId === XIANGYANG_WORKSPACE_ID
    );
  }
  if (fromXy) return true;
  return kind !== "agent-home";
}

function workspaceLastActiveAt(
  runtime: FaceRuntime,
  workspaceId: string,
  sessionIds: readonly string[],
  updatedAtIso: string,
): number {
  let latest = Date.parse(updatedAtIso);
  if (!Number.isFinite(latest)) latest = 0;
  for (const id of sessionIds) {
    const meta = runtime.projections.stateOf(id, "sessionListMetadata") as
      | { readonly lastPromptAt?: number | null; readonly blank?: boolean }
      | undefined;
    if (meta?.blank === true) continue;
    const at = meta?.lastPromptAt;
    if (typeof at === "number" && Number.isFinite(at) && at > latest) {
      latest = at;
    }
  }
  return latest;
}

function matchesQuery(row: WorkspaceListRow, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return (
    row.workspaceId.toLowerCase().includes(q)
    || row.title.toLowerCase().includes(q)
    || row.path.toLowerCase().includes(q)
    || (row.member ? row.member.toLowerCase().includes(q) : false)
  );
}

/**
 * Build the workspace_list payload for this seat.
 * Pins current canvas + reserved 向阳/IM; defaults to active-only.
 */
export function listWorkspacesForDiscovery(
  runtime: FaceRuntime,
  sessionId: string,
  query: WorkspaceListQuery = {},
): {
  readonly items: readonly WorkspaceListRow[];
  readonly omittedInactive: number;
  readonly activeWindowHours: number;
} {
  const settings = readWorkspaceDiscoverySettings(runtime);
  const now = Date.now();
  const windowMs = settings.activeWindowHours * 60 * 60 * 1000;
  const cutoff = now - windowMs;
  const currentId = runtime.workspaces.workspaceIdOf(sessionId) ?? "";
  const listed = runtime.workspaces.list(runtime.store.list());
  const needle = typeof query.query === "string" ? query.query.trim() : "";
  const includeInactive = query.includeInactive === true || needle.length > 0;

  const scored: ScoredWorkspace[] = [];
  for (const row of listed.items) {
    if (!laneAllows(runtime, sessionId, row.workspaceId, row.kind)) continue;
    const lastActiveAt = workspaceLastActiveAt(
      runtime,
      row.workspaceId,
      row.sessionIds,
      row.updatedAt,
    );
    const pinned =
      row.workspaceId === currentId
      || row.workspaceId === XIANGYANG_WORKSPACE_ID
      || row.workspaceId === IM_WORKSPACE_ID;
    const active = pinned || lastActiveAt >= cutoff;
    const scoredRow: ScoredWorkspace = {
      workspaceId: row.workspaceId,
      title: row.title,
      path: row.path,
      sessionCount: row.sessionIds.length,
      active,
      lastActiveAt,
      ...(isAgentHomeWorkspace(runtime, row.workspaceId)
        ? { member: row.boundMemberId ?? null }
        : row.workspaceId === IM_WORKSPACE_ID
          ? { im: true as const }
          : row.workspaceId === XIANGYANG_WORKSPACE_ID
            ? { xiangyang: true as const }
            : {}),
    };
    if (!matchesQuery(scoredRow, needle)) continue;
    scored.push(scoredRow);
  }

  scored.sort((a, b) => {
    if (a.active !== b.active) return a.active ? -1 : 1;
    return b.lastActiveAt - a.lastActiveAt;
  });

  const activeRows = scored.filter((row) => row.active);
  const inactiveRows = scored.filter((row) => !row.active);
  const callLimitRaw = query.limit;
  const callLimit =
    typeof callLimitRaw === "number" && Number.isFinite(callLimitRaw)
      ? Math.max(1, Math.floor(callLimitRaw))
      : settings.maxListItems;
  const cap = Math.min(settings.maxListItems, callLimit);

  let picked: ScoredWorkspace[];
  let omittedInactive: number;
  if (includeInactive) {
    picked = scored.slice(0, cap);
    omittedInactive = Math.max(0, scored.length - picked.length);
  } else {
    const activeCap = Math.min(settings.maxActiveItems, cap);
    picked = activeRows.slice(0, activeCap);
    omittedInactive = inactiveRows.length;
  }

  // Wire: drop lastActiveAt; omit active:true; keep active:false on dormant.
  const items: WorkspaceListRow[] = picked.map((row) => {
    const wire: WorkspaceListRow = {
      workspaceId: row.workspaceId,
      title: row.title,
      path: row.path,
      sessionCount: row.sessionCount,
      ...(row.active ? {} : { active: false }),
      ...(row.member !== undefined ? { member: row.member } : {}),
      ...(row.im ? { im: true } : {}),
      ...(row.xiangyang ? { xiangyang: true } : {}),
    };
    return wire;
  });

  return {
    items,
    omittedInactive,
    activeWindowHours: settings.activeWindowHours,
  };
}
