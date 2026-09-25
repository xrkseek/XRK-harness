/** Catalog of Face-exposed session agent presets (tool composition badges). */

export type AgentToolComposition = "minimal" | "harness";

/**
 * Built-in session badges (five tiers).
 * Plan mode is `/plan` / `exit_plan_mode`, not a badge.
 * Order matches product picker: lighter → fuller.
 */
export type CatalogAgentPresetId =
  | "minimal"
  | "shell"
  | "frugal"
  | "shallow"
  | "harness";

/** Subagent policy for a session badge (Host binds tools from this). */
export interface AgentSubagentPolicy {
  readonly mode: "off" | "on";
  /**
   * Optional badge ceiling on nesting depth when mode is on.
   * Live cap is Face `agent-loop.maxSubagentDepth` (default
   * {@link DEFAULT_MAX_DEPTH}); effective = min(face, this) when set.
   */
  readonly maxDepth?: number;
  /**
   * Optional badge ceiling on concurrent active children under one parent.
   * Live cap is Face `agent-loop.maxActiveSubagents` (default
   * {@link DEFAULT_MAX_ACTIVE_CHILDREN}).
   */
  readonly maxActiveChildren?: number;
}

/** Harness-plane tool switches (ignored when composition is minimal). */
export interface AgentToolFlags {
  readonly web: boolean;
  readonly lsp: boolean;
  readonly pty: boolean;
}

export interface AgentPresetProfile {
  readonly id: CatalogAgentPresetId;
  readonly composition: AgentToolComposition;
  readonly tools: AgentToolFlags;
  readonly subagents: AgentSubagentPolicy;
  /** Skip harness `tool:subagent` routing prompt when subagents are off. */
  readonly subagentRouting: boolean;
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
}

/** Face / tool default: nesting depth cap (Hermes-style tighter than historical 3). */
export const DEFAULT_MAX_DEPTH = 2;
/** Face / tool default: concurrent active children under one parent. */
export const DEFAULT_MAX_ACTIVE_CHILDREN = 2;

const FULL_TOOLS: AgentToolFlags = { web: true, lsp: true, pty: true };
const SHELL_TOOLS: AgentToolFlags = { web: false, lsp: false, pty: true };
const MINIMAL_TOOLS: AgentToolFlags = { web: false, lsp: false, pty: false };

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
      planModeDefault: false,
    },
  },
  {
    id: "shallow",
    displayName: "Shallow",
    description:
      "Full coding tools with one-level subagents only (maxDepth 1, concurrency capped by Face)",
    profile: {
      id: "shallow",
      composition: "harness",
      tools: FULL_TOOLS,
      subagents: {
        mode: "on",
        maxDepth: 1,
      },
      subagentRouting: true,
      planModeDefault: false,
    },
  },
  {
    id: "harness",
    displayName: "XRK Harness",
    description:
      "Full coding agent: fs + bash + web + lsp + PTY + nested subagents (capped by Face depth/active limits)",
    profile: {
      id: "harness",
      composition: "harness",
      tools: FULL_TOOLS,
      subagents: {
        mode: "on",
      },
      subagentRouting: true,
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
