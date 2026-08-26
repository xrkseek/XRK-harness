import { access, readdir, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import type { InstructionChange } from "./durable-inject.js";
import {
  HOME_CONVENTION_INJECT,
  WORKSPACE_CONVENTION_INJECT,
  type ConventionInjectProfile,
} from "./inject-sources.js";
import {
  boundInstructionFile,
  clipToBudget,
  type InjectBudget,
} from "./inject-budget.js";
import {
  DEFAULT_MARKDOWN_DIR_MAX_DEPTH,
  nextScanDepth,
  shouldSkipScanDir,
} from "./scan-guards.js";

export interface InstructionSection {
  /** Stable path for `changes[]` and section headers (posix-style). */
  readonly path: string;
  readonly body: string;
}

export interface CollectEcosystemInstructionsOptions {
  readonly root: string;
  readonly productDir: string;
  readonly budget: InjectBudget;
  /**
   * Also inject user-home convention paths (`~/.agents`, `~/.xrk`, …).
   * Default true — lower priority than workspace; workspace wins on duplicate body.
   */
  readonly includeUserHome?: boolean;
  /** Test override for user-home root (default `os.homedir()`). */
  readonly homeDir?: string;
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
    const raw = await readFile(p, "utf8");
    return boundInstructionFile(raw);
  } catch {
    return undefined;
  }
}

function stripMdcFrontmatter(raw: string): string {
  const body = raw.replace(/^\uFEFF/, "");
  if (!body.startsWith("---")) return body;
  const end = body.indexOf("\n---", 3);
  if (end <= 0) return body;
  return body.slice(end + 4).replace(/^\r?\n/, "");
}

/** Frontmatter gate: `xrk-inject: false` skips Host product inject (Cursor may still read the rule). */
function mdcHostInjectEnabled(raw: string): boolean {
  const body = raw.replace(/^\uFEFF/, "");
  if (!body.startsWith("---")) return true;
  const end = body.indexOf("\n---", 3);
  if (end <= 0) return true;
  const fm = body.slice(3, end);
  return !/^xrk-inject:\s*false\s*$/im.test(fm);
}

function isAgentsImportOnly(text: string): boolean {
  const trimmed = text.trim();
  return /^@AGENTS\.md\s*$/i.test(trimmed);
}

async function pushFile(
  sections: InstructionSection[],
  absPath: string,
  logicalPath: string,
  budget: InjectBudget,
  seen: Set<string>,
): Promise<void> {
  const raw = await readIfExists(absPath);
  if (!raw?.trim()) return;
  const digest = raw.trim();
  if (seen.has(digest)) return;
  const clipped = clipToBudget(logicalPath, raw, budget);
  if (!clipped.trim()) return;
  seen.add(digest);
  sections.push({ path: logicalPath, body: clipped });
}

async function pushMarkdownDir(
  sections: InstructionSection[],
  dir: string,
  prefix: string,
  budget: InjectBudget,
  seen: Set<string>,
  depth: number,
  options?: { readonly stripMdc?: boolean },
): Promise<void> {
  if (budget.left <= 0) return;
  if (!(await exists(dir))) return;
  const names = (await readdir(dir)).sort();
  for (const name of names) {
    if (shouldSkipScanDir(name)) continue;
    const abs = path.join(dir, name);
    let entryStat;
    try {
      entryStat = await stat(abs);
    } catch {
      continue;
    }
    if (entryStat.isDirectory()) {
      const nextDepth = nextScanDepth(depth, DEFAULT_MARKDOWN_DIR_MAX_DEPTH);
      if (nextDepth === null) continue;
      await pushMarkdownDir(
        sections,
        abs,
        `${prefix}${name}/`,
        budget,
        seen,
        nextDepth,
        options,
      );
      continue;
    }
    if (!/\.(md|mdc|markdown)$/i.test(name)) continue;
    const raw = await readIfExists(abs);
    if (!raw?.trim()) continue;
    if (name.endsWith(".mdc") && !mdcHostInjectEnabled(raw)) continue;
    let body = raw;
    if (options?.stripMdc || name.endsWith(".mdc")) {
      body = stripMdcFrontmatter(raw);
    }
    if (!body.trim()) continue;
    const logical = `${prefix}${name}`.replace(/\\/g, "/");
    const digest = body.trim();
    if (seen.has(digest)) continue;
    const clipped = clipToBudget(logical, body, budget);
    if (!clipped.trim()) continue;
    seen.add(digest);
    sections.push({ path: logical, body: clipped });
  }
}

const PRODUCT_STANDING_FILES = [
  "SOUL.md",
  "USER.md",
  "IDENTITY.md",
  "TOOLS.md",
  "AGENTS.md",
] as const;

/** Multi-vendor convention paths under one base directory. */
async function pushConventionLayer(
  sections: InstructionSection[],
  base: string,
  logicalPrefix: string,
  budget: InjectBudget,
  seen: Set<string>,
  profile: ConventionInjectProfile,
): Promise<void> {
  const lp = (suffix: string) =>
    logicalPrefix ? `${logicalPrefix}${suffix}` : suffix;

  if (profile.codexAgents) {
    await pushFile(
      sections,
      path.join(base, ".codex", "AGENTS.md"),
      lp(".codex/AGENTS.md"),
      budget,
      seen,
    );
  }
  if (profile.codexRootMd) {
    await pushFile(
      sections,
      path.join(base, "CODEX.md"),
      lp("CODEX.md"),
      budget,
      seen,
    );
  }

  if (profile.claude) {
    await pushFile(
      sections,
      path.join(base, ".claude", "CLAUDE.md"),
      lp(".claude/CLAUDE.md"),
      budget,
      seen,
    );
    await pushMarkdownDir(
      sections,
      path.join(base, ".claude", "rules"),
      lp(".claude/rules/"),
      budget,
      seen,
      0,
    );
  }

  if (profile.agents) {
    await pushFile(
      sections,
      path.join(base, ".agents", "AGENTS.md"),
      lp(".agents/AGENTS.md"),
      budget,
      seen,
    );
    await pushMarkdownDir(
      sections,
      path.join(base, ".agents", "rules"),
      lp(".agents/rules/"),
      budget,
      seen,
      0,
    );
    const agentsCtxDir = path.join(base, ".agents", "context");
    if (await exists(agentsCtxDir)) {
      const files = (await readdir(agentsCtxDir)).sort();
      for (const f of files) {
        await pushFile(
          sections,
          path.join(agentsCtxDir, f),
          lp(`.agents/context/${f}`),
          budget,
          seen,
        );
      }
    }
  }

  if (profile.cursorRules) {
    await pushMarkdownDir(
      sections,
      path.join(base, ".cursor", "rules"),
      lp(".cursor/rules/"),
      budget,
      seen,
      0,
      { stripMdc: true },
    );
  }

  if (profile.github) {
    await pushFile(
      sections,
      path.join(base, ".github", "copilot-instructions.md"),
      lp(".github/copilot-instructions.md"),
      budget,
      seen,
    );
    await pushMarkdownDir(
      sections,
      path.join(base, ".github", "instructions"),
      lp(".github/instructions/"),
      budget,
      seen,
      0,
    );
  }
}

async function pushProductStanding(
  sections: InstructionSection[],
  productDir: string,
  logicalPrefix: string,
  budget: InjectBudget,
  seen: Set<string>,
): Promise<void> {
  if (!(await exists(productDir))) return;

  for (const name of PRODUCT_STANDING_FILES) {
    await pushFile(
      sections,
      path.join(productDir, name),
      `${logicalPrefix}${name}`,
      budget,
      seen,
    );
  }

  const assistant =
    (await readIfExists(path.join(productDir, "assistant.md"))) ??
    (await readIfExists(path.join(productDir, "ASSISTANT.md")));
  if (assistant?.trim()) {
    const assistantPath = (await exists(path.join(productDir, "assistant.md")))
      ? `${logicalPrefix}assistant.md`
      : `${logicalPrefix}ASSISTANT.md`;
    const clipped = clipToBudget(assistantPath, assistant, budget);
    if (clipped.trim()) {
      const digest = clipped.trim();
      if (!seen.has(digest)) {
        seen.add(digest);
        sections.push({ path: assistantPath, body: clipped });
      }
    }
  }

  const ctxDir = path.join(productDir, "context");
  if (await exists(ctxDir)) {
    const files = (await readdir(ctxDir)).sort();
    for (const f of files) {
      await pushFile(
        sections,
        path.join(ctxDir, f),
        `${logicalPrefix}context/${f}`,
        budget,
        seen,
      );
    }
  }

  const rules =
    (await readIfExists(path.join(productDir, "rules.md"))) ??
    (await readIfExists(path.join(productDir, "RULES.md")));
  if (rules?.trim()) {
    const rulesPath = (await exists(path.join(productDir, "rules.md")))
      ? `${logicalPrefix}rules.md`
      : `${logicalPrefix}RULES.md`;
    const clipped = clipToBudget(rulesPath, rules, budget);
    if (clipped.trim()) {
      const digest = clipped.trim();
      if (!seen.has(digest)) {
        seen.add(digest);
        sections.push({ path: rulesPath, body: clipped });
      }
    }
  }

  const subagents = await readIfExists(path.join(productDir, "subagents.md"));
  if (subagents?.trim()) {
    const clipped = clipToBudget(`${logicalPrefix}subagents.md`, subagents, budget);
    if (clipped.trim()) {
      const digest = clipped.trim();
      if (!seen.has(digest)) {
        seen.add(digest);
        sections.push({ path: `${logicalPrefix}subagents.md`, body: clipped });
      }
    }
  }
}

/**
 * Gather agent instruction markdown from multi-vendor convention paths.
 * Policy: {@link HOME_CONVENTION_INJECT} · {@link WORKSPACE_CONVENTION_INJECT} in `inject-sources.ts`.
 * Low → high priority in output order (later sections appear closer to the turn):
 *
 * 1. User home when `includeUserHome`
 * 2. Workspace convention paths
 * 3. Workspace `{productDir}` (default `.xrk/`)
 * 4. Workspace root `AGENTS.md` / `CLAUDE.md` (unless product overlay exists)
 *
 * Skills trees are handled separately (skill catalog).
 */
export async function collectEcosystemInstructions(
  options: CollectEcosystemInstructionsOptions,
): Promise<InstructionSection[]> {
  const root = path.resolve(options.root);
  const productDir = path.resolve(options.productDir);
  const sections: InstructionSection[] = [];
  const seen = new Set<string>();
  const includeUserHome = options.includeUserHome !== false;

  if (includeUserHome) {
    const home = path.resolve(options.homeDir ?? homedir());
    await pushConventionLayer(
      sections,
      home,
      "~/",
      options.budget,
      seen,
      HOME_CONVENTION_INJECT,
    );
    await pushProductStanding(
      sections,
      path.join(home, ".xrk"),
      "~/.xrk/",
      options.budget,
      seen,
    );
  }

  await pushConventionLayer(
    sections,
    root,
    "",
    options.budget,
    seen,
    WORKSPACE_CONVENTION_INJECT,
  );
  await pushProductStanding(sections, productDir, ".xrk/", options.budget, seen);

  const productAgents = await readIfExists(path.join(productDir, "AGENTS.md"));
  const agentsAgents = await readIfExists(path.join(root, ".agents", "AGENTS.md"));
  if (!productAgents?.trim() && !agentsAgents?.trim()) {
    await pushFile(
      sections,
      path.join(root, "AGENTS.md"),
      "AGENTS.md",
      options.budget,
      seen,
    );
  }

  const claudeRoot = await readIfExists(path.join(root, "CLAUDE.md"));
  if (claudeRoot?.trim() && !isAgentsImportOnly(claudeRoot)) {
    const clipped = clipToBudget("CLAUDE.md", claudeRoot, options.budget);
    if (clipped.trim()) {
      const digest = clipped.trim();
      if (!seen.has(digest)) {
        seen.add(digest);
        sections.push({ path: "CLAUDE.md", body: clipped });
      }
    }
  }

  return sections;
}

export function sectionsToInstructionBlocks(
  sections: readonly InstructionSection[],
): string[] {
  return sections.map((s) => `## ${s.path}\n${s.body}`);
}

export function sectionsToInstructionChanges(
  sections: readonly InstructionSection[],
): InstructionChange[] {
  return sections.map((s) => ({
    action: "merge" as const,
    path: s.path,
  }));
}
