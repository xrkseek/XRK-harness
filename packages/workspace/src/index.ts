import { mkdir, readFile, readdir, writeFile, access, stat } from "node:fs/promises";
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

export type { WorkspaceBudgetEvent } from "./durable-inject.js";

export type WorkspaceInjectResult = WorkspaceDurableInject;

export interface WorkspaceInjector {
  inject(options?: { maxChars?: number }): Promise<WorkspaceInjectResult>;
  syncSeeds(seedDir: string): Promise<{ created: string[] }>;
}

export interface WorkspaceInjectorOptions {
  readonly root: string;
  /** Product inject overlay — default `{root}/.xrk` (see ecosystem paths). */
  readonly productDir?: string;
}

async function exists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
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
      });
      const instructionBlocks = sectionsToInstructionBlocks(sections);
      const changes = sectionsToInstructionChanges(sections);

      // Skills — durable catalog; preview `blocks` still include markdown cards
      const skills = await listSkills({
        workspaceRoot: root,
        productDir,
        includeUserHome: false,
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

    async syncSeeds(seedDir) {
      // Explicit seed only — inject / skill import never mkdir `.xrk`.
      const created: string[] = [];
      if (!(await exists(seedDir))) {
        return { created };
      }
      await mkdir(productDir, { recursive: true });

      async function walk(rel: string): Promise<void> {
        const srcBase = path.join(seedDir, rel);
        const entries = await readdir(srcBase).catch(() => [] as string[]);
        for (const name of entries) {
          if (name === "README.md") continue;
          const relPath = rel ? path.join(rel, name) : name;
          const src = path.join(seedDir, relPath);
          const dest = path.join(productDir, relPath);
          const s = await stat(src);
          if (s.isDirectory()) {
            await mkdir(dest, { recursive: true });
            await walk(relPath);
            continue;
          }
          if (await exists(dest)) continue; // 缺补不覆盖
          const text = await readFile(src, "utf8");
          await mkdir(path.dirname(dest), { recursive: true });
          await writeFile(dest, text, "utf8");
          created.push(relPath.replace(/\\/g, "/"));
        }
      }

      await walk("");
      return { created };
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
  /**
   * If set, run syncSeeds before inject (缺补不覆盖).
   * Typical: path to templates/office-agent.
   */
  readonly syncSeedsFrom?: string;
}

export interface ResolvedWorkspaceInject {
  readonly injector: WorkspaceInjector;
  readonly blocks: readonly string[];
  readonly instructionBlocks: readonly string[];
  readonly events: readonly WorkspaceBudgetEvent[];
  readonly durable: WorkspaceDurableInject;
  /** Files created by optional syncSeeds (empty if not synced). */
  readonly seeded: readonly string[];
}

/**
 * Create injector, optional seed sync, then resolve durable + preview blocks.
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

  let seeded: string[] = [];
  if (options.syncSeedsFrom) {
    const result = await injector.syncSeeds(options.syncSeedsFrom);
    seeded = [...result.created];
  }

  const out = await injector.inject(
    options.maxChars !== undefined ? { maxChars: options.maxChars } : {},
  );

  return {
    injector,
    blocks: out.blocks,
    instructionBlocks: out.instructionBlocks,
    events: out.events,
    durable: out,
    seeded,
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
