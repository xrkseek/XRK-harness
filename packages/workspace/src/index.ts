import { mkdir, readFile, readdir, writeFile, access, stat } from "node:fs/promises";
import path from "node:path";
import { formatSkillCatalog, listSkills } from "./skills.js";

export interface WorkspaceBudgetEvent {
  readonly type: "workspace/budget-truncation";
  readonly section: string;
  readonly originalChars: number;
  readonly keptChars: number;
}

export interface WorkspaceInjectResult {
  readonly blocks: string[];
  readonly events: WorkspaceBudgetEvent[];
}

export interface WorkspaceInjector {
  inject(options?: { maxChars?: number }): Promise<WorkspaceInjectResult>;
  syncSeeds(seedDir: string): Promise<{ created: string[] }>;
}

export interface WorkspaceInjectorOptions {
  readonly root: string;
  /** Product inject root — never the repo AGENTS.md at monorepo root. */
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

async function readIfExists(p: string): Promise<string | undefined> {
  try {
    return await readFile(p, "utf8");
  } catch {
    return undefined;
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
 * Injection order:
 * 1 assistant md · 2 contextFiles · 3 rules · 4 skills cards · 5 subagents list
 * Root AGENTS.md of the host repo is never injected (productDir isolation).
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
      const blocks: string[] = [];

      // 1. assistant md
      const assistant =
        (await readIfExists(path.join(productDir, "assistant.md"))) ??
        (await readIfExists(path.join(productDir, "ASSISTANT.md")));
      if (assistant) {
        const t = clip("assistant", assistant, budget);
        if (t) blocks.push(`## Assistant\n${t}`);
      }

      // 2. contextFiles
      const ctxDir = path.join(productDir, "context");
      if (await exists(ctxDir)) {
        const files = (await readdir(ctxDir)).sort();
        for (const f of files) {
          const text = await readIfExists(path.join(ctxDir, f));
          if (!text) continue;
          const t = clip(`context:${f}`, text, budget);
          if (t) blocks.push(`## Context: ${f}\n${t}`);
        }
      }

      // 3. rules full text
      const rules =
        (await readIfExists(path.join(productDir, "rules.md"))) ??
        (await readIfExists(path.join(productDir, "RULES.md")));
      if (rules) {
        const t = clip("rules", rules, budget);
        if (t) blocks.push(`## Rules\n${t}`);
      }

      // 4. skills directory cards (name + description; full body via `skill` tool)
      const skillCards = formatSkillCatalog(
        await listSkills({ productDir }),
      );
      if (skillCards) {
        const t = clip("skills", skillCards, budget);
        if (t) blocks.push(t);
      }

      // 5. subagents list
      const subagents =
        (await readIfExists(path.join(productDir, "subagents.md"))) ?? "";
      if (subagents.trim()) {
        const t = clip("subagents", subagents, budget);
        if (t) blocks.push(`## Subagents\n${t}`);
      }

      // Isolation: never read root AGENTS.md as product inject
      const rootAgents = path.join(root, "AGENTS.md");
      if (await exists(rootAgents)) {
        // explicit no-op — documented for tests
      }

      return { blocks, events: budget.events };
    },

    async syncSeeds(seedDir) {
      const created: string[] = [];
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
  formatSkillCatalog,
  isSkillName,
  listSkills,
  listSkillsFromWorkspace,
  loadSkill,
  parseSkillMarkdown,
  renderSkillContent,
  type SkillDefinition,
  type SkillSummary,
} from "./skills.js";

export { createSkillTools, presentSkillCall } from "./skill-tools.js";

export {
  createWorkspaceToolOutputPersist,
  type WorkspaceToolOutputPersist,
  type WorkspaceToolOutputPersistOptions,
} from "./tool-output-persist.js";

/**
 * Options for resolving product-workspace blocks into three-layer assemble.
 * Default product dir: `{root}/.xrk` (never repo-root AGENTS.md).
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
  readonly events: readonly WorkspaceBudgetEvent[];
  /** Files created by optional syncSeeds (empty if not synced). */
  readonly seeded: readonly string[];
}

/**
 * Create injector, optional seed sync, then inject for assemble.workspaceBlocks.
 * Presets call this once per createAgent() (fresh inject each agent bind).
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
    events: out.events,
    seeded,
  };
}
