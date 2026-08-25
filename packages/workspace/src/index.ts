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
import { createInjectBudget } from "./inject-budget.js";
import { formatWorkspaceRootAnchor } from "./workspace-anchor.js";
import { computeInjectFingerprint } from "./inject-fingerprint.js";

export type { WorkspaceBudgetEvent } from "./durable-inject.js";

export type WorkspaceInjectResult = WorkspaceDurableInject;

export interface WorkspaceInjector {
  inject(options?: { maxChars?: number }): Promise<WorkspaceInjectResult>;
  /** Drop memoized inject (tests / hot reload). */
  clearCache(): void;
  /**
   * True when inject roots match the last successful `inject()` fingerprint
   * (Codex session cache / DSH digest fast path).
   */
  isDiskUnchanged(): Promise<boolean>;
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
  let cachedInject: WorkspaceInjectResult | undefined;
  let cachedMaxChars: number | undefined;
  let cachedFingerprint: string | undefined;

  const fingerprintOptions = () => ({
    root,
    productDir,
    ...(options.includeUserHome !== undefined
      ? { includeUserHome: options.includeUserHome }
      : {}),
    ...(options.homeDir !== undefined ? { homeDir: options.homeDir } : {}),
    includeUserHomeSkills: true,
  });

  return {
    clearCache() {
      cachedInject = undefined;
      cachedMaxChars = undefined;
      cachedFingerprint = undefined;
    },

    async isDiskUnchanged(): Promise<boolean> {
      if (cachedFingerprint === undefined) return false;
      const fp = await computeInjectFingerprint(fingerprintOptions());
      return fp === cachedFingerprint;
    },

    async inject({ maxChars = 32_000 } = {}) {
      const fingerprint = await computeInjectFingerprint(fingerprintOptions());
      if (
        cachedInject !== undefined
        && cachedMaxChars === maxChars
        && cachedFingerprint === fingerprint
      ) {
        return cachedInject;
      }

      const budget = createInjectBudget(maxChars);

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

      // Skills — progressive disclosure catalog (name + description); budget-clipped.
      // Home + workspace roots (Codex); cached via mtime fingerprint between turns.
      const includeHome = options.includeUserHome !== false;
      const skills = await listSkills({
        workspaceRoot: root,
        productDir,
        includeUserHome: includeHome,
      });
      // Durable XML catalog consumes model budget; preview markdown is UI-only.
      const skillCatalog = buildSkillCatalogPayload(skills, budget);
      const skillBlock = formatSkillCatalog(skills);

      const previewBlocks = [
        ...instructionBlocks,
        ...(skillBlock ? [skillBlock] : []),
      ];

      const instructions = buildInstructionsPayload(
        instructionBlocks,
        changes,
        budget.events,
      );

      cachedMaxChars = maxChars;
      cachedFingerprint = fingerprint;
      cachedInject = {
        instructionBlocks,
        blocks: previewBlocks,
        events: budget.events,
        ...(skillCatalog ? { skillCatalog } : {}),
        ...(instructions ? { instructions } : {}),
      };
      return cachedInject;
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
  existingInjector?: WorkspaceInjector,
): Promise<ResolvedWorkspaceInject> {
  const injector =
    existingInjector ??
    createWorkspaceInjector({
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
  /** Reuse preset injector so inject is memoized across turns (DSH digest path). */
  readonly injector?: WorkspaceInjector;
}): Promise<readonly WorkspaceInjectAppend[]> {
  const previous = foldLatestWorkspaceInjectDigests(
    input.store.get(input.sessionId).events,
  );

  // DSH / Codex: digests already in session and disk unchanged → skip inject work.
  if (
    previous.instructions !== undefined
    && previous.skillCatalog !== undefined
    && input.injector !== undefined
    && (await input.injector.isDiskUnchanged())
  ) {
    return [];
  }

  const resolved = await resolveWorkspaceInject(
    input.injectOptions,
    input.injector,
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
