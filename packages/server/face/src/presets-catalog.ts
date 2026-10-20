/** Catalog of Face-exposed session agent presets (tool composition badges). */

export type AgentToolComposition = "minimal" | "harness";

/**
 * Built-in session badges (five tiers).
 * Plan mode is `/plan` / `exit_plan_mode`, not a badge.
 * Order matches product picker: lighter → fuller.
 */
export type CatalogAgentPresetId =
  | "minimal"
  | "im"
  | "qichuang"
  | "shell"
  | "frugal"
  | "shallow"
  | "harness";

/** Subagent policy for a session badge (Host binds tools from this). */
export interface AgentSubagentPolicy {
  readonly mode: "off" | "on";
}

/** Harness-plane tool switches (ignored when composition is minimal). */
export interface AgentToolFlags {
  readonly web: boolean;
  readonly lsp: boolean;
  readonly pty: boolean;
}

/**
 * When a session may spawn subagents without the user asking for it
 * (Codex `multi_agent.rs`: two mutually exclusive mode instructions, chosen
 * per session rather than hardcoded into one prompt).
 *
 * - `explicit` — spawn only when the user, AGENTS.md, or the task itself asks
 *   for delegation. "Go deeper / investigate more" is NOT authorization.
 * - `proactive` — spawning is an approved strategy; spawn when it actually
 *   helps. Live sessions still share the per-model concurrent cap.
 */
export type DelegationMode = "explicit" | "proactive";

export interface AgentPresetProfile {
  readonly id: CatalogAgentPresetId;
  readonly composition: AgentToolComposition;
  readonly tools: AgentToolFlags;
  readonly subagents: AgentSubagentPolicy;
  /** Skip harness `tool:subagent` routing prompt when subagents are off. */
  readonly subagentRouting: boolean;
  /**
   * Delegation posture while `subagents.mode === "on"` (badge with subagents
   * off never spawns, so the value is unused there).
   */
  readonly delegation: DelegationMode;
  /**
   * Seed `plan/mode` active on session.create.
   * Prefer `/plan` for collaboration mode; badges keep this false.
   */
  readonly planModeDefault: boolean;
}

export interface AgentPresetInfo {
  readonly id: CatalogAgentPresetId;
  readonly displayName: string;
  readonly description: string;
  readonly profile: AgentPresetProfile;
  /**
   * IM / Qichuang — pinned by workspace, never a Settings coding default.
   * Absent / false for normal coding badges.
   */
  readonly workspaceLocked?: boolean;
}

/** Settings / hero pickers only offer coding badges (not IM / Qichuang). */
export function isWorkspaceLockedAgentPreset(id: string): boolean {
  return id === "im" || id === "qichuang";
}

/** @deprecated Prefer {@link DEFAULT_MAX_CONCURRENT_MODEL_SESSIONS} in model-session-cap. */
export const DEFAULT_MAX_DEPTH = 0;
/** @deprecated Prefer per-model concurrent session cap. */
export const DEFAULT_MAX_ACTIVE_CHILDREN = 0;

const FULL_TOOLS: AgentToolFlags = { web: true, lsp: true, pty: true };
const SHELL_TOOLS: AgentToolFlags = { web: false, lsp: false, pty: true };
const MINIMAL_TOOLS: AgentToolFlags = { web: false, lsp: false, pty: false };
/** Xiangyang orchestrator — full harness tool switches (no nested subagents). */
const QICHUANG_TOOLS: AgentToolFlags = { web: true, lsp: true, pty: true };

const SUBAGENTS_OFF: AgentSubagentPolicy = { mode: "off" };

/**
 * Session badges offered in the product UI.
 * Host CLI also accepts `server` (same as harness) — see {@link resolveAgentPresetProfile}.
 */
export const FACE_AGENT_PRESETS: readonly AgentPresetInfo[] = [
  {
    id: "minimal",
    displayName: "Minimal",
    description:
      "Filesystem, skill, and std tools only — no bash, web, lsp, PTY, or subagents",
    profile: {
      id: "minimal",
      composition: "minimal",
      tools: MINIMAL_TOOLS,
      subagents: SUBAGENTS_OFF,
      subagentRouting: false,
      delegation: "explicit",
      planModeDefault: false,
    },
  },
  {
    id: "shell",
    displayName: "Shell",
    description:
      "Filesystem, bash, and terminal (PTY) — no web, lsp, or subagents",
    profile: {
      id: "shell",
      composition: "harness",
      tools: SHELL_TOOLS,
      subagents: SUBAGENTS_OFF,
      subagentRouting: false,
      delegation: "explicit",
      planModeDefault: false,
    },
  },
  {
    id: "frugal",
    displayName: "Frugal",
    description:
      "Full coding tools without subagents — lower bill risk",
    profile: {
      id: "frugal",
      composition: "harness",
      tools: FULL_TOOLS,
      subagents: SUBAGENTS_OFF,
      subagentRouting: false,
      delegation: "explicit",
      planModeDefault: false,
    },
  },
  {
    id: "shallow",
    displayName: "Shallow",
    description:
      "Full coding tools with subagents (same per-model session cap as Harness; prefer lighter delegation)",
    profile: {
      id: "shallow",
      composition: "harness",
      tools: FULL_TOOLS,
      subagents: { mode: "on" },
      subagentRouting: true,
      delegation: "proactive",
      planModeDefault: false,
    },
  },
  {
    id: "harness",
    displayName: "XRK Harness",
    description:
      "Full coding agent: fs + bash + web + lsp + PTY + subagents + workspace/thread collab (per-model live session cap)",
    profile: {
      id: "harness",
      composition: "harness",
      tools: FULL_TOOLS,
      subagents: { mode: "on" },
      subagentRouting: true,
      delegation: "proactive",
      planModeDefault: false,
    },
  },
  // Workspace-locked — catalog tail; Settings default never selects these.
  {
    id: "im",
    displayName: "IM",
    description:
      "IM channel (`ws_im`): im_send / team / session_query / workspace_* / thread_* + subagent(workspace_id) into coding — no bash, web, lsp, PTY, or presence",
    workspaceLocked: true,
    profile: {
      id: "im",
      composition: "minimal",
      tools: MINIMAL_TOOLS,
      subagents: { mode: "on" },
      subagentRouting: true,
      delegation: "proactive",
      planModeDefault: false,
    },
  },
  {
    id: "qichuang",
    displayName: "Qichuang",
    description:
      "Xiangyang locked surface: team + workspace_* / thread_* + web + lsp + PTY — no nested subagents",
    workspaceLocked: true,
    profile: {
      id: "qichuang",
      // Host builds harness composition; full tool flags + no nested subagents.
      composition: "harness",
      tools: QICHUANG_TOOLS,
      subagents: SUBAGENTS_OFF,
      subagentRouting: false,
      delegation: "explicit",
      planModeDefault: false,
    },
  },
];

const PROFILE_BY_ID = new Map(
  FACE_AGENT_PRESETS.map((p) => [p.id, p.profile] as const),
);

/** Host `--preset` / env ids (includes legacy `server` / `plan` → harness). */
export const HOST_CLI_PRESET_IDS = [
  ...FACE_AGENT_PRESETS.map((p) => p.id),
  "server",
  "plan",
] as const;

/** Ids accepted on the wire (includes legacy `server` / `plan` → harness). */
export const FACE_AGENT_PRESET_IDS = new Set<string>(HOST_CLI_PRESET_IDS);

/** Reject or coerce Settings `agent-presets.default` away from locked badges. */
export function isCodingAgentPresetSettingsId(id: string): boolean {
  const raw = id.trim();
  if (!raw || isWorkspaceLockedAgentPreset(raw)) return false;
  if (raw === "server" || raw === "plan") return true;
  return FACE_AGENT_PRESET_IDS.has(raw);
}

/**
 * Normalize wire / Host `--preset` to a catalog profile.
 * Unknown ids fall back to `hostFallback` (default harness).
 * Legacy `server` and `plan` map to harness tools (`/plan` owns collaboration mode).
 */
export function resolveAgentPresetProfile(
  agentPreset: string | undefined,
  hostFallback = "harness",
): AgentPresetProfile {
  const raw = (agentPreset?.trim() || hostFallback).trim();
  if (raw === "server" || raw === "plan") return PROFILE_BY_ID.get("harness")!;
  const hit = PROFILE_BY_ID.get(raw as CatalogAgentPresetId);
  if (hit) return hit;
  const fallbackRaw = hostFallback.trim();
  if (fallbackRaw === "server" || fallbackRaw === "plan") {
    return PROFILE_BY_ID.get("harness")!;
  }
  return (
    PROFILE_BY_ID.get(fallbackRaw as CatalogAgentPresetId) ??
    PROFILE_BY_ID.get("harness")!
  );
}

/**
 * Map session badge / Host `--preset` to the tool composition package.
 * `server` is the Host-plane CLI name; tools match harness.
 */
export function resolveToolPreset(
  agentPreset: string | undefined,
  hostFallback = "harness",
): AgentToolComposition {
  return resolveAgentPresetProfile(agentPreset, hostFallback).composition;
}

/** Persist only catalog ids (legacy `server` → `harness`). */
export function canonicalAgentPresetId(id: string): CatalogAgentPresetId {
  return resolveAgentPresetProfile(id, "harness").id;
}
