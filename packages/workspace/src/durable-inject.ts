/**
 * DSH-aligned durable workspace injects: skill catalog + agent instructions
 * as model-visible `user/message` payloads (not system workspaceBlocks).
 */
import { createHash } from "node:crypto";
import path from "node:path";
import type {
  SessionEvent,
  UserMessageSource,
  WorkspaceBudgetTruncation,
} from "@xrkseek/protocol";
import { clipToBudget, type InjectBudget } from "./inject-budget.js";
import {
  recordShadowSkillSelection,
  selectSkillsForBudget,
  type SkillSelectMode,
  type SkillSelectionResult,
} from "./skill-select.js";
import type { SkillSummary } from "./skills.js";

export interface WorkspaceBudgetEvent {
  readonly type: "workspace/budget-truncation";
  readonly section: string;
  readonly originalChars: number;
  readonly keptChars: number;
}

export function digestWorkspaceText(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex").slice(0, 16);
}

export function budgetEventsToTruncations(
  events: readonly WorkspaceBudgetEvent[],
): readonly WorkspaceBudgetTruncation[] {
  return events.map((e) => ({
    section: e.section,
    originalChars: e.originalChars,
    keptChars: e.keptChars,
  }));
}

function underRoot(dir: string, root: string): boolean {
  const resolved = path.resolve(dir);
  const base = path.resolve(root);
  return (
    resolved === base ||
    resolved.startsWith(base + path.sep) ||
    resolved.replace(/\\/g, "/").startsWith(base.replace(/\\/g, "/") + "/")
  );
}

/**
 * Pack order before budget clip (progressive catalog — keep head, truncate tail):
 * 0. 公文包 / preferred dirs (干员 · 其子会话)
 * 1. workspace skills + product seed `xrk-*`
 * 2. other global / home installs
 *
 * No `skill_search` tool — disclosure is this catalog → `skill` loads body.
 * (`tool_search` is for deferred tools, not skills.)
 */
export function orderSkillsForCatalogBudget(
  skills: readonly SkillSummary[],
  workspaceRoot?: string,
  preferredSkillDirs?: readonly string[],
): SkillSummary[] {
  const ws = workspaceRoot ? path.resolve(workspaceRoot) : undefined;
  const preferred = (preferredSkillDirs ?? []).map((d) => path.resolve(d));
  const underPreferred = (dir: string): boolean =>
    preferred.some((root) => underRoot(dir, root));
  const underWs = (dir: string): boolean => (ws ? underRoot(dir, ws) : false);
  const tier = (s: SkillSummary): number => {
    if (preferred.length > 0 && underPreferred(s.directory)) return 0;
    if (underWs(s.directory) || s.name.startsWith("xrk-")) return 1;
    return 2;
  };
  return [...skills].sort((a, b) => {
    const d = tier(a) - tier(b);
    if (d !== 0) return d;
    return a.name.localeCompare(b.name);
  });
}

/** DSH-shaped model-facing skill catalog (progressive disclosure). */
export function formatAvailableSkillsXml(
  skills: readonly SkillSummary[],
): string {
  const listed = skills.filter((s) => s.modelInvocable);
  const lines = listed.map(
    (s) => `- \`${s.name}\`: ${s.description}`,
  );
  return [
    "<system-reminder>",
    "<available_skills>",
    ...lines,
    "</available_skills>",
    "Progressive skills: catalog = name+blurb; call `skill` with the exact name for the body (no skill_search — tool_search is for deferred tools). Head prefers 公文包 (when present), then workspace + xrk-* seeds; globals may be truncated — then shell-list Product home `skills/*/SKILL.md` / workspace `.agents/skills/`.",
    "</system-reminder>",
  ].join("\n");
}

export interface DurableSkillCatalogPayload {
  readonly content: string;
  readonly digest: string;
  readonly source: Extract<UserMessageSource, { kind: "skill-catalog" }>;
  /**
   * Present when `selection.mode` is `shadow` or `select` — offline eval /
   * observability only. Shadow mode never changes {@link content}.
   */
  readonly selection?: SkillSelectionResult;
}

export interface DurableInstructionsPayload {
  readonly content: string;
  readonly digest: string;
  readonly source: Extract<UserMessageSource, { kind: "agent-instructions" }>;
}

export interface WorkspaceDurableInject {
  /** Preview / durable instructions markdown (no skill cards). */
  readonly instructionBlocks: readonly string[];
  /** Full legacy blocks including skill cards (previewInject). */
  readonly blocks: readonly string[];
  readonly events: readonly WorkspaceBudgetEvent[];
  readonly skillCatalog?: DurableSkillCatalogPayload;
  readonly instructions?: DurableInstructionsPayload;
}

export interface InstructionChange {
  readonly action: "set" | "merge" | "clear";
  readonly path?: string;
}

export function buildSkillCatalogPayload(
  skills: readonly SkillSummary[],
  budget: InjectBudget,
  options?: {
    readonly update?: boolean;
    readonly workspaceRoot?: string;
    /** 干员公文包 roots — listed ahead of workspace when truncating. */
    readonly preferredSkillDirs?: readonly string[];
    readonly selection?: {
      readonly mode?: SkillSelectMode;
      readonly query?: string;
    };
  },
): DurableSkillCatalogPayload | undefined {
  const listed = orderSkillsForCatalogBudget(
    skills.filter((s) => s.modelInvocable),
    options?.workspaceRoot,
    options?.preferredSkillDirs,
  );
  if (listed.length === 0) return undefined;
  const mode = options?.selection?.mode ?? "truncate";
  const query = options?.selection?.query;

  // `select`: pack by relevance until the remaining budget fits (no mid-entry clip).
  if (mode === "select") {
    const packed = selectSkillsForBudget(listed, budget.left, query);
    const full = formatAvailableSkillsXml(packed.selected);
    const content = clipToBudget("skills", full, budget, {
      suffix: "\n[skill catalog truncated] Prefer `skill` by exact name. Else shell-list Product home `skills/*/SKILL.md` + workspace `.agents/skills/` (公文包 / xrk-* / workspace kept first).",
    });
    if (!content.trim()) return undefined;
    const included = listedForClippedCatalog(packed.selected, content);
    const skillBudget = budget.events.filter((e) => e.section === "skills");
    const truncations = budgetEventsToTruncations(skillBudget);
    const digest = digestWorkspaceText(content);
    return {
      content,
      digest,
      selection: packed,
      source: {
        kind: "skill-catalog",
        form: "catalog",
        entries: included.map((s) => ({
          name: s.name,
          description: s.description,
        })),
        digest,
        ...(options?.update ? { update: true as const } : {}),
        ...(truncations.length > 0 ? { budgetTruncations: truncations } : {}),
      },
    };
  }

  // `truncate` (default) and `shadow`: same prompt bytes; shadow only records selection.
  const selection =
    mode === "shadow"
      ? recordShadowSkillSelection(listed, budget.left, query)
      : undefined;
  const full = formatAvailableSkillsXml(listed);
  const content = clipToBudget("skills", full, budget, {
    suffix: "\n[skill catalog truncated] Prefer `skill` by exact name. Else shell-list Product home `skills/*/SKILL.md` + workspace `.agents/skills/` (公文包 / xrk-* / workspace kept first).",
  });
  if (!content.trim()) return undefined;
  const included = listedForClippedCatalog(listed, content);
  const skillBudget = budget.events.filter((e) => e.section === "skills");
  const truncations = budgetEventsToTruncations(skillBudget);
  const digest = digestWorkspaceText(content);
  return {
    content,
    digest,
    ...(selection ? { selection } : {}),
    source: {
      kind: "skill-catalog",
      form: "catalog",
      entries: included.map((s) => ({
        name: s.name,
        description: s.description,
      })),
      digest,
      ...(options?.update ? { update: true as const } : {}),
      ...(truncations.length > 0 ? { budgetTruncations: truncations } : {}),
    },
  };
}

function listedForClippedCatalog(
  listed: readonly SkillSummary[],
  content: string,
): readonly SkillSummary[] {
  return listed.filter((s) => content.includes(`\`${s.name}\``));
}

export function buildInstructionsPayload(
  blocks: readonly string[],
  changes: readonly InstructionChange[],
  budgetEvents: readonly WorkspaceBudgetEvent[],
): DurableInstructionsPayload | undefined {
  const content = blocks.join("\n\n").trim();
  if (!content) return undefined;
  const instructionBudget = budgetEvents.filter((e) => e.section !== "skills");
  const truncations = budgetEventsToTruncations(instructionBudget);
  const digest = digestWorkspaceText(content);
  return {
    content,
    digest,
    source: {
      kind: "agent-instructions",
      form: "instructions",
      changes: changes.length > 0 ? [...changes] : [{ action: "set" }],
      digest,
      ...(truncations.length > 0 ? { budgetTruncations: truncations } : {}),
    },
  };
}

export interface LatestWorkspaceInjectDigests {
  readonly skillCatalog?: string;
  readonly instructions?: string;
}

/** Last-wins digests from durable inject `user/message` events. */
export function foldLatestWorkspaceInjectDigests(
  events: readonly SessionEvent[],
): LatestWorkspaceInjectDigests {
  let skillCatalog: string | undefined;
  let instructions: string | undefined;
  for (let i = events.length - 1; i >= 0; i--) {
    const ev = events[i];
    if (ev === undefined || ev.type !== "user/message" || !ev.source) continue;
    if (
      skillCatalog === undefined
      && ev.source.kind === "skill-catalog"
      && ev.source.digest
    ) {
      skillCatalog = ev.source.digest;
    } else if (
      instructions === undefined
      && ev.source.kind === "agent-instructions"
      && ev.source.digest
    ) {
      instructions = ev.source.digest;
    }
    if (skillCatalog !== undefined && instructions !== undefined) break;
  }
  return {
    ...(skillCatalog !== undefined ? { skillCatalog } : {}),
    ...(instructions !== undefined ? { instructions } : {}),
  };
}

export interface WorkspaceInjectAppend {
  readonly content: string;
  readonly source: UserMessageSource;
}

/**
 * Decide which durable injects to append (digest change or first sighting).
 * Empty catalog after a prior catalog appends a replacement empty row.
 */
export function planWorkspaceInjectAppends(input: {
  readonly durable: WorkspaceDurableInject;
  readonly previous: LatestWorkspaceInjectDigests;
}): readonly WorkspaceInjectAppend[] {
  const out: WorkspaceInjectAppend[] = [];
  const { durable, previous } = input;

  if (durable.skillCatalog) {
    const update = previous.skillCatalog !== undefined;
    if (durable.skillCatalog.digest !== previous.skillCatalog) {
      const source = update
        ? { ...durable.skillCatalog.source, update: true as const }
        : durable.skillCatalog.source;
      out.push({ content: durable.skillCatalog.content, source });
    }
  } else if (previous.skillCatalog !== undefined) {
    const content = [
      "<system-reminder>",
      "<available_skills>",
      "</available_skills>",
      "</system-reminder>",
    ].join("\n");
    out.push({
      content,
      source: {
        kind: "skill-catalog",
        form: "catalog",
        entries: [],
        update: true,
        digest: digestWorkspaceText(content),
      },
    });
  }

  if (durable.instructions) {
    if (durable.instructions.digest !== previous.instructions) {
      out.push({
        content: durable.instructions.content,
        source: durable.instructions.source,
      });
    }
  } else if (previous.instructions !== undefined) {
    out.push({
      content: "(workspace instructions cleared)",
      source: {
        kind: "agent-instructions",
        form: "instructions",
        changes: [{ action: "clear" }],
        digest: digestWorkspaceText("(workspace instructions cleared)"),
      },
    });
  }

  return out;
}

