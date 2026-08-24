import path from "node:path";
import { newUserMessageId } from "@xrkseek/protocol";
import {
  collectEcosystemInstructions,
  sectionsToInstructionBlocks,
  sectionsToInstructionChanges,
} from "./ecosystem-instructions.js";
import { formatSkillCatalog, listSkills } from "./skills.js";
import {
  buildInstructionsPayload,
  buildSkillCatalogPayload,
  foldLatestWorkspaceInjectDigests,
  planWorkspaceInjectAppends,
  type WorkspaceBudgetEvent,
  type WorkspaceDurableInject,
  type WorkspaceInjectAppend,
} from "./durable-inject.js";
import { formatWorkspaceRootAnchor } from "./workspace-anchor.js";

export type { WorkspaceBudgetEvent } from "./durable-inject.js";

export type WorkspaceInjectResult = WorkspaceDurableInject;

export interface WorkspaceInjector {
  inject(options?: { maxChars?: number }): Promise<WorkspaceInjectResult>;
}

export interface WorkspaceInjectorOptions {
  readonly root: string;
  /** Product inject overlay — default `{root}/.xrk` (see ecosystem paths). */
  readonly productDir?: string;
  /** Include user-home global layer (default true). */
  readonly includeUserHome?: boolean;
  /** Test override for user-home root. */
  readonly homeDir?: string;
}

function clip(
  section: string,
  text: string,
  budget: { left: number; events: WorkspaceBudgetEvent[] },
): string {
  if (budget.left <= 0) {
    budget.events.push({
      type: "workspace/budget-truncation",
      section,
      originalChars: text.length,
      keptChars: 0,
    });
    return "";
  }
  if (text.length <= budget.left) {
    budget.left -= text.length;
    return text;
  }
  const kept = text.slice(0, budget.left);
  budget.events.push({
    type: "workspace/budget-truncation",
    section,
    originalChars: text.length,
    keptChars: kept.length,
  });
  budget.left = 0;
  return kept + "\n[truncated]";
}

/**
 * Multi-vendor instruction paths + skill catalog (see `ecosystem-instructions.ts`
 * and `docs/workspace-inject.md`). Durable: agent-instructions + skill-catalog
 * as separate `user/message` payloads; `blocks` kept for previewInject only.
 */
export function createWorkspaceInjector(
  options: WorkspaceInjectorOptions,
): WorkspaceInjector {
  const productDir = path.resolve(
    options.productDir ?? path.join(options.root, ".xrk"),
  );
  const root = path.resolve(options.root);

  return {
    async inject({ maxChars = 32_000 } = {}) {
      const budget = { left: maxChars, events: [] as WorkspaceBudgetEvent[] };

      const sections = await collectEcosystemInstructions({
        root,
        productDir,
        budget,
        ...(options.includeUserHome !== undefined
          ? { includeUserHome: options.includeUserHome }
          : {}),
        ...(options.homeDir !== undefined ? { homeDir: options.homeDir } : {}),
      });
      const instructionBlocks = sectionsToInstructionBlocks(sections);
      const changes = sectionsToInstructionChanges(sections);

      // Skills — durable catalog; preview `blocks` still include markdown cards
      const skills = await listSkills({
        workspaceRoot: root,
        productDir,
        ...(options.includeUserHome !== undefined
          ? { includeUserHome: options.includeUserHome }
          : {}),
      });
      const skillCards = formatSkillCatalog(skills);
      let skillBlock: string | undefined;
      if (skillCards) {
        const t = clip("skills", skillCards, budget);
        if (t) skillBlock = t;
      }

      const previewBlocks = [
        ...instructionBlocks,
        ...(skillBlock ? [skillBlock] : []),
      ];

      const skillCatalog = buildSkillCatalogPayload(skills, budget.events);
      const instructions = buildInstructionsPayload(
        instructionBlocks,
        changes,
        budget.events,
      );

      return {
        instructionBlocks,
        blocks: previewBlocks,
        events: budget.events,
        ...(skillCatalog ? { skillCatalog } : {}),
        ...(instructions ? { instructions } : {}),
      };
    },
  };
}

/** Test helper: assert root AGENTS.md path is not used as productDir default. */
export function isProductInjectPath(
  root: string,
  candidate: string,
): boolean {
  const agents = path.resolve(root, "AGENTS.md");
  return path.resolve(candidate) !== agents;
}

export {
  applyRecipe,
  loadOfficeRecipes,
  loadRecipeFile,
  parseRecipeYaml,
  type Recipe,
  type RecipeParam,
} from "./recipes.js";

export {
  createSlashResolver,
  mapSlashRestToValues,
  parseSlashCommand,
  tryApplySlashRecipe,
  tryApplySlashSkill,
  type SlashCommand,
  type SlashRecipeResult,
} from "./slash.js";

export {
  SKILL_TOOL_GUIDANCE,
  PROJECT_SKILL_REL_DIRS,
  USER_SKILL_REL_DIRS,
  formatSkillCatalog,
  isSkillName,
  listSkills,
  listSkillsFromWorkspace,
  listSkillsInDir,
  loadSkill,
  parseSkillMarkdown,
  renderSkillContent,
  resolveSkillDirs,
  type SkillDefinition,
  type SkillSourceOptions,
  type SkillSummary,
} from "./skills.js";

export { createSkillTools, presentSkillCall } from "./skill-tools.js";

export {
  createWorkspaceToolOutputPersist,
  type WorkspaceToolOutputPersist,
  type WorkspaceToolOutputPersistOptions,
} from "./tool-output-persist.js";

export {
  buildInstructionsPayload,
  buildSkillCatalogPayload,
  budgetEventsToTruncations,
  digestWorkspaceText,
  foldLatestWorkspaceInjectDigests,
  formatAvailableSkillsXml,
  planWorkspaceInjectAppends,
  type DurableInstructionsPayload,
  type DurableSkillCatalogPayload,
  type InstructionChange,
  type LatestWorkspaceInjectDigests,
  type WorkspaceDurableInject,
  type WorkspaceInjectAppend,
} from "./durable-inject.js";

/**
 * Options for resolving product-workspace injects.
 * Default product dir: `{root}/.xrk` plus ecosystem convention paths.
 */
export interface ResolveWorkspaceInjectOptions {
  readonly root: string;
  readonly productDir?: string;
  readonly maxChars?: number;
  /** Sidebar workspace title — injected as display-only (not a path). */
  readonly displayTitle?: string;
}

export interface ResolvedWorkspaceInject {
  readonly injector: WorkspaceInjector;
  readonly blocks: readonly string[];
  readonly instructionBlocks: readonly string[];
  readonly events: readonly WorkspaceBudgetEvent[];
  readonly durable: WorkspaceDurableInject;
}

/**
 * Create injector, then resolve durable + preview blocks.
 * Presets call this once per createAgent(); durable injects append at turn start.
 */
export async function resolveWorkspaceInject(
  options: ResolveWorkspaceInjectOptions,
): Promise<ResolvedWorkspaceInject> {
  const injector = createWorkspaceInjector({
    root: options.root,
    ...(options.productDir !== undefined
      ? { productDir: options.productDir }
      : {}),
  });

  const out = await injector.inject(
    options.maxChars !== undefined ? { maxChars: options.maxChars } : {},
  );

  const anchor = formatWorkspaceRootAnchor(options.root, options.displayTitle);
  const instructionBlocks = anchor
    ? [anchor, ...out.instructionBlocks]
    : out.instructionBlocks;
  const priorChanges = out.instructions?.source.changes ?? [{ action: "set" as const }];
  const instructionChanges = anchor
    ? [{ action: "set" as const, path: "workspace-root" }, ...priorChanges]
    : priorChanges;
  const instructions = buildInstructionsPayload(
    instructionBlocks,
    instructionChanges,
    out.events,
  );
  const durable: WorkspaceDurableInject = {
    ...out,
    instructionBlocks,
    ...(instructions ? { instructions } : {}),
  };

  return {
    injector,
    blocks: anchor ? [anchor, ...out.blocks] : out.blocks,
    instructionBlocks,
    events: out.events,
    durable,
  };
}

/** Append durable workspace injects when digests changed (turn boundary). */
export async function appendWorkspaceInjectsIfChanged(input: {
  readonly store: {
    get(sessionId: string): {
      readonly events: readonly import("@xrkseek/protocol").SessionEvent[];
    };
    append(
      sessionId: string,
      event: import("@xrkseek/protocol").SessionEvent,
    ): unknown;
  };
  readonly sessionId: string;
  readonly turnId: string;
  readonly now: () => number;
  readonly injectOptions: ResolveWorkspaceInjectOptions;
}): Promise<readonly WorkspaceInjectAppend[]> {
  const resolved = await resolveWorkspaceInject(input.injectOptions);
  const previous = foldLatestWorkspaceInjectDigests(
    input.store.get(input.sessionId).events,
  );
  const appends = planWorkspaceInjectAppends({
    durable: resolved.durable,
    previous,
  });
  for (const row of appends) {
    input.store.append(input.sessionId, {
      type: "user/message",
      ts: input.now(),
      turnId: input.turnId,
      messageId: newUserMessageId(),
      content: row.content,
      source: row.source,
    });
  }
  return appends;
}
