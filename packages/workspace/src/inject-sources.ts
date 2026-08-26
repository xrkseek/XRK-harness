/**
 * Standing inject policy — single source of truth for Host workspace inject.
 *
 * XRK-Harness posture (Codex-aligned progressive disclosure):
 * - **`.xrk/` native first** — wins on skill name clash within a layer.
 * - **Home `~/.cursor/**`**: never injected (Cursor IDE maintainer tree).
 * - **Workspace `{root}/.cursor/rules/**`**: injected when present (`xrk-inject: false` opts out per file).
 * - **Skills catalog**: workspace trees only by default; home trees via `skill` tool on demand.
 */

/** Which convention paths to scan under one base directory (home or workspace). */
export interface ConventionInjectProfile {
  /** `{base}/.codex/AGENTS.md` */
  readonly codexAgents: boolean;
  /** `{base}/CODEX.md` — workspace only (not home). */
  readonly codexRootMd: boolean;
  /** `{base}/.claude/CLAUDE.md` + `.claude/rules/**` */
  readonly claude: boolean;
  /** `{base}/.agents/AGENTS.md` + rules + context */
  readonly agents: boolean;
  /** `{base}/.cursor/rules/**` — **never** on home; workspace only. */
  readonly cursorRules: boolean;
  /** `{base}/.github/copilot-instructions.md` + instructions/** — workspace only. */
  readonly github: boolean;
}

/** Global layer (`~/*`) — cross-project persona. No Cursor maintainer paths. */
export const HOME_CONVENTION_INJECT: ConventionInjectProfile = {
  codexAgents: true,
  codexRootMd: false,
  claude: true,
  agents: true,
  cursorRules: false,
  github: false,
};

/** Workspace layer (`{root}/*`) — project overlay; includes project `.cursor/rules`. */
export const WORKSPACE_CONVENTION_INJECT: ConventionInjectProfile = {
  codexAgents: true,
  codexRootMd: true,
  claude: true,
  agents: true,
  cursorRules: true,
  github: true,
};

/** XRK-native vendor priority — lower index wins on name clash (within the same layer). */
export const SKILL_VENDOR_PRIORITY = [
  ".xrk/skills",
  ".agents/skills",
  ".cursor/skills",
  ".claude/skills",
  ".codex/skills",
] as const;

/** Relative skill roots under user home — `skill` tool only (not standing catalog by default). */
export const USER_HOME_SKILL_REL_DIRS = [
  ".xrk/skills",
  ".agents/skills",
  ".claude/skills",
  ".codex/skills",
] as const;

/** Relative skill roots under workspace — standing catalog + `skill` tool. */
export const WORKSPACE_SKILL_REL_DIRS = [...SKILL_VENDOR_PRIORITY] as readonly string[];

/** Instruction fingerprint markers per layer (stat-only invalidation). */
export const HOME_INSTRUCTION_FINGERPRINT_MARKERS = [
  ".xrk/AGENTS.md",
  ".xrk/SOUL.md",
  ".agents/AGENTS.md",
  ".agents/rules",
  ".agents/context",
  ".claude/CLAUDE.md",
  ".codex/AGENTS.md",
] as const;

export const WORKSPACE_INSTRUCTION_FINGERPRINT_MARKERS = [
  ...HOME_INSTRUCTION_FINGERPRINT_MARKERS,
  ".cursor/rules",
  "CODEX.md",
  ".github/copilot-instructions.md",
  ".github/instructions",
  "AGENTS.md",
  "CLAUDE.md",
  "assistant.md",
  "rules.md",
  "subagents.md",
] as const;
