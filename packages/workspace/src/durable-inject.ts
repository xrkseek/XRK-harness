/**
 * DSH-aligned durable workspace injects: skill catalog + agent instructions
 * as model-visible `user/message` payloads (not system workspaceBlocks).
 */
import { createHash } from "node:crypto";
import type {
  SessionEvent,
  UserMessageSource,
  WorkspaceBudgetTruncation,
} from "@xrkseek/protocol";
import { clipToBudget, type InjectBudget } from "./inject-budget.js";
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
    "Use the skill tool with the exact skill name to load full instructions before acting on a matching task.",
    "</system-reminder>",
  ].join("\n");
}

export interface DurableSkillCatalogPayload {
  readonly content: string;
  readonly digest: string;
  readonly source: Extract<UserMessageSource, { kind: "skill-catalog" }>;
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
  options?: { readonly update?: boolean },
): DurableSkillCatalogPayload | undefined {
  const listed = skills.filter((s) => s.modelInvocable);
  if (listed.length === 0) return undefined;
  const full = formatAvailableSkillsXml(listed);
  const content = clipToBudget("skills", full, budget, {
    suffix: "\n[skill catalog truncated]",
  });
  if (!content.trim()) return undefined;
  const included = listedForClippedCatalog(listed, content);
  const skillBudget = budget.events.filter((e) => e.section === "skills");
  const truncations = budgetEventsToTruncations(skillBudget);
  const digest = digestWorkspaceText(content);
  return {
    content,
    digest,
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

