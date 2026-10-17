/**
 * Learning-loop skill proposal: draft a SKILL.md, require human confirm, then
 * install under the workspace skills root (Hermes write_approval / skill_manage
 * create path — consent before commit; no background fork in this slice).
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import type { ToolDefinition } from "@xrkseek/core-tools";
import {
  installSkillFromLocalDir,
  SkillInstallError,
  WORKSPACE_SKILLS_REL_DIR,
  type SkillInstallResult,
} from "./skill-install.js";
import { isSkillName, parseSkillMarkdown } from "./skills.js";

export const PROPOSE_SKILL_TOOL = "propose_skill";

/** Where a proposed skill is written. */
export type ProposeSkillScope = "workspace" | "global";

/** `workspace` (default) or `global`. Anything else is refused. */
export function parseProposeSkillScope(
  raw: unknown,
): ProposeSkillScope | undefined {
  if (raw === undefined || raw === "workspace") return "workspace";
  if (raw === "global") return "global";
  return undefined;
}

/** Home `~/.agents/skills` — global scope, not the product `~/.xrk` tree. */
export function defaultGlobalSkillsRoot(): string {
  return path.join(homedir(), ".agents", "skills");
}

/** Default tool-call count on one turn that counts as "complex" for a nudge. */
export const LEARNING_LOOP_COMPLEX_TOOL_THRESHOLD = 5;

export interface ProposeSkillDraft {
  readonly name: string;
  readonly description: string;
  readonly body: string;
  readonly markdown: string;
  /** Workspace-relative path shown in the confirm UI. */
  readonly targetRel: string;
}

export interface ProposeSkillConfirmResult {
  readonly approved: boolean;
  readonly feedback?: string;
}

export interface WriteProposedSkillOptions {
  readonly workspaceRoot: string;
  readonly markdown: string;
  readonly force?: boolean;
  readonly skillsRoot?: string;
}

/**
 * Assemble a valid SKILL.md (frontmatter + body). Body may already include a
 * leading `#` heading; frontmatter name/description always win for routing.
 */
export function buildProposedSkillMarkdown(input: {
  readonly name: string;
  readonly description: string;
  readonly body: string;
}): string {
  const name = input.name.trim();
  const description = input.description.trim().replace(/\s+/g, " ");
  const body = input.body.replace(/^\uFEFF/, "").replace(/^\r?\n/, "");
  const descLine =
    description.includes(":") || description.includes("#")
      ? `description: ${JSON.stringify(description)}`
      : `description: ${description}`;
  return `---\nname: ${name}\n${descLine}\n---\n\n${body.trimEnd()}\n`;
}

/** Validate + publish a draft markdown into the skills root (fail-closed). */
export function writeProposedSkill(
  options: WriteProposedSkillOptions,
): SkillInstallResult {
  const markdown = options.markdown.replace(/^\uFEFF/, "");
  if (!/^---\r?\n/.test(markdown)) {
    throw new SkillInstallError(
      "proposed SKILL.md must start with YAML frontmatter",
      "SKILL_INVALID",
    );
  }
  const fmEnd = markdown.indexOf("\n---", 3);
  if (fmEnd < 0) {
    throw new SkillInstallError(
      "proposed SKILL.md frontmatter is not closed",
      "SKILL_INVALID",
    );
  }
  const fm = markdown.slice(3, fmEnd);
  if (!/^name\s*:\s*\S/m.test(fm) || !/^description\s*:\s*\S/m.test(fm)) {
    throw new SkillInstallError(
      "proposed skill frontmatter needs explicit name and description",
      "SKILL_INVALID",
    );
  }

  const parsed = parseSkillMarkdown(markdown, "draft");
  if (parsed.invalid) {
    throw new SkillInstallError(
      "proposed SKILL.md frontmatter is invalid (fail closed)",
      "SKILL_INVALID",
    );
  }
  const name = parsed.name.trim();
  if (!isSkillName(name)) {
    throw new SkillInstallError(
      `invalid skill name "${name}"`,
      "SKILL_NAME",
    );
  }
  if (!parsed.description.trim()) {
    throw new SkillInstallError(
      "proposed skill needs a non-empty description",
      "SKILL_INVALID",
    );
  }

  const staging = mkdtempSync(path.join(tmpdir(), "xrk-propose-skill-"));
  try {
    // Basename matches skill name so publishSkill fallback agrees with frontmatter.
    const skillDir = path.join(staging, name);
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(path.join(skillDir, "SKILL.md"), markdown, "utf8");
    return installSkillFromLocalDir(skillDir, {
      workspaceRoot: options.workspaceRoot,
      ...(options.skillsRoot !== undefined
        ? { skillsRoot: options.skillsRoot }
        : {}),
      ...(options.force === true ? { force: true } : {}),
    });
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
}

export function presentProposeSkillCall(args: {
  name: string;
  description?: string;
}): {
  readonly card: "generic";
  readonly title: string;
  readonly kind: "other";
  readonly rawInput: unknown;
} {
  return {
    card: "generic",
    title: `Propose skill ${args.name}`,
    kind: "other",
    rawInput: args,
  };
}

/**
 * Model-facing propose → human confirm → write.
 * Without `askConfirm` the tool refuses (no silent disk writes).
 */
export function createProposeSkillTool(options: {
  /** Current session workspace. */
  readonly resolveWorkspaceRoot: () => string;
  /** Home `~/.agents/skills`. Defaults to {@link defaultGlobalSkillsRoot}. */
  readonly resolveGlobalSkillsRoot?: () => string;
  readonly askConfirm?: (
    draft: ProposeSkillDraft,
    signal?: AbortSignal,
  ) => Promise<ProposeSkillConfirmResult>;
}): ToolDefinition {
  return {
    name: PROPOSE_SKILL_TOOL,
    description:
      "Propose a reusable SKILL.md playbook after a complex task. " +
      "This is not an Agent Team member. If the user asked for a 干员, 成员, teammate, or 子代理团队的一员, call `team_save` instead. " +
      "Pass name, description, and markdown body (lessons / procedure — not a chat log). " +
      "scope=workspace (default) writes the current workspace `.agents/skills`; " +
      "scope=global writes the home directory `~/.agents/skills`. " +
      "The user must approve before anything is written.",
    parameters: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description:
            "Skill directory / frontmatter name (lowercase-hyphenated).",
        },
        description: {
          type: "string",
          description:
            "One-sentence routing description (what + when); keep it short.",
        },
        body: {
          type: "string",
          description:
            "Markdown body after frontmatter: When to Use, Procedure, Pitfalls. Class-level lessons, not incident logs.",
        },
        scope: {
          type: "string",
          description:
            "workspace (default): current workspace .agents/skills. global: home ~/.agents/skills. Not an Agent Team roster.",
        },
        force: {
          type: "boolean",
          description: "Overwrite an existing skill of the same name.",
        },
      },
      required: ["name", "description", "body"],
    },
    presentCall: (args) => {
      const a = args as { name?: string; description?: string };
      return presentProposeSkillCall({
        name: String(a.name ?? "").trim() || "skill",
        ...(a.description !== undefined
          ? { description: String(a.description) }
          : {}),
      });
    },
    async execute(args, signal) {
      const a = args as {
        name?: string;
        description?: string;
        body?: string;
        scope?: string;
        force?: boolean;
      };
      const scope = parseProposeSkillScope(a.scope);
      if (scope === undefined) {
        return {
          content: 'Error: scope must be "workspace" or "global"',
          isError: true,
        };
      }
      const name = String(a.name ?? "").trim();
      const description = String(a.description ?? "").trim();
      const body = String(a.body ?? "");
      if (!isSkillName(name)) {
        return {
          content: `Error: invalid skill name "${name}"`,
          isError: true,
        };
      }
      if (!description) {
        return {
          content: "Error: description must be non-empty",
          isError: true,
        };
      }
      if (!body.trim()) {
        return { content: "Error: body must be non-empty", isError: true };
      }

      const markdown = buildProposedSkillMarkdown({ name, description, body });
      const parsed = parseSkillMarkdown(markdown, name);
      if (parsed.invalid) {
        return {
          content: "Error: assembled SKILL.md frontmatter is invalid",
          isError: true,
        };
      }

      const workspaceRoot = options.resolveWorkspaceRoot();
      const skillsRoot = path.resolve(
        scope === "global"
          ? (options.resolveGlobalSkillsRoot?.() ?? defaultGlobalSkillsRoot())
          : path.join(workspaceRoot, WORKSPACE_SKILLS_REL_DIR),
      );
      const targetRel =
        scope === "global"
          ? path.join(skillsRoot, name, "SKILL.md")
          : path
              .join(WORKSPACE_SKILLS_REL_DIR, name, "SKILL.md")
              .split(path.sep)
              .join("/");

      const draft: ProposeSkillDraft = {
        name,
        description,
        body,
        markdown,
        targetRel,
      };

      if (!options.askConfirm) {
        return {
          content:
            "propose_skill unavailable (no confirm channel); ask the user to approve writing the skill, or use `xrkh skill add` offline",
          isError: true,
        };
      }

      let confirm: ProposeSkillConfirmResult;
      try {
        confirm = await options.askConfirm(draft, signal);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { content: msg, isError: true };
      }

      if (!confirm.approved) {
        const feedback = confirm.feedback?.trim();
        return {
          content: feedback
            ? `User rejected skill write: ${feedback}`
            : "User rejected skill write; nothing was written",
        };
      }

      try {
        const result = writeProposedSkill({
          workspaceRoot,
          markdown,
          skillsRoot,
          ...(a.force === true ? { force: true } : {}),
        });
        return {
          content: JSON.stringify({
            ok: true,
            name: result.name,
            directory: result.directory,
            targetRel,
            skillsRoot,
            scope,
          }),
        };
      } catch (err) {
        if (err instanceof SkillInstallError) {
          return { content: `Error: ${err.message}`, isError: true };
        }
        throw err;
      }
    },
  } satisfies ToolDefinition;
}

/** Per-session complex-turn counter for learning-loop nudges. */
const complexTurnCounts = new Map<string, number>();
const pendingNudges = new Set<string>();

/** Record a finished turn; arm a nudge after enough complex turns (Hermes interval). */
export function noteLearningLoopTurn(
  sessionId: string,
  toolCalls: number,
  options?: {
    readonly complexThreshold?: number;
    readonly nudgeInterval?: number;
  },
): void {
  const complexThreshold =
    options?.complexThreshold ?? LEARNING_LOOP_COMPLEX_TOOL_THRESHOLD;
  const nudgeInterval = options?.nudgeInterval ?? 2;
  if (toolCalls < complexThreshold) return;
  const next = (complexTurnCounts.get(sessionId) ?? 0) + 1;
  if (next >= nudgeInterval) {
    complexTurnCounts.set(sessionId, 0);
    pendingNudges.add(sessionId);
  } else {
    complexTurnCounts.set(sessionId, next);
  }
}

/** Clear counters after a successful propose_skill write. */
export function clearLearningLoopNudge(sessionId: string): void {
  complexTurnCounts.delete(sessionId);
  pendingNudges.delete(sessionId);
}

/** Consume a pending nudge for the next model-visible inject (once). */
export function consumeLearningLoopNudge(sessionId: string): boolean {
  if (!pendingNudges.has(sessionId)) return false;
  pendingNudges.delete(sessionId);
  return true;
}

/** Model-facing nudge copy (lessons not logs; confirm before write). */
export function learningLoopNudgeText(): string {
  return (
    "Learning loop: this session just finished a complex multi-tool turn. " +
    "If you produced a reusable procedure, call `propose_skill` with a class-level SKILL.md draft " +
    "(When to Use + Procedure + Pitfalls — not a chat transcript). " +
    "scope=workspace writes the current workspace `.agents/skills`; scope=global writes home `~/.agents/skills`. " +
    "A 干员 / 成员 / 子代理团队的一员 is `team_save`, not this tool. " +
    "The user must approve before anything is written."
  );
}

/** Test hook. */
export function resetLearningLoopNudgeStateForTests(): void {
  complexTurnCounts.clear();
  pendingNudges.clear();
}
