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
  claimScanDir,
  claimScanEntry,
  claimScanRoot,
  createScanBudget,
  nextScanDepth,
  shouldSkipScanDir,
  type ScanBudget,
} from "./scan-guards.js";
import {
  resolveUserProductHome,
  userProductHomeLogicalPrefix,
} from "./user-product-home.js";

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
  /**
   * Only gates the manager ledger `XRK.md` (`user` = inject; `subagent` /
   * `minimal` = skip). Home product standing + home convention + workspace
   * convention always inject when present. Badge / permission never use this.
   */
  readonly audience?: "user" | "subagent" | "minimal";
  readonly includeSkills?: boolean;
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

/** Frontmatter gate: `xrk-inject: false` skips Host product inject (Cursor may still read the file). */
function markdownHostInjectEnabled(raw: string): boolean {
  const body = raw.replace(/^\uFEFF/, "");
  if (!body.startsWith("---")) return true;
  const end = body.indexOf("\n---", 3);
  if (end <= 0) return true;
  const fm = body.slice(3, end);
  return !/^xrk-inject:\s*false\s*$/im.test(fm);
}

/** @deprecated Prefer {@link markdownHostInjectEnabled}. */
function mdcHostInjectEnabled(raw: string): boolean {
  return markdownHostInjectEnabled(raw);
}

/** Drop leading YAML frontmatter so inject body stays model-facing prose. */
function stripYamlFrontmatter(raw: string): string {
  const body = raw.replace(/^\uFEFF/, "");
  if (!body.startsWith("---")) return raw;
  const end = body.indexOf("\n---", 3);
  if (end <= 0) return raw;
  return body.slice(end + 4).replace(/^\r?\n/, "");
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
  if (!markdownHostInjectEnabled(raw)) return;
  const body = stripYamlFrontmatter(raw);
  if (!body.trim()) return;
  const digest = body.trim();
  if (seen.has(digest)) return;
  const clipped = clipToBudget(logicalPath, body, budget);
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
  scan: ScanBudget,
  options?: { readonly stripMdc?: boolean },
): Promise<void> {
  if (budget.left <= 0 || scan.stopped) return;
  if (depth === 0 && !claimScanRoot(scan)) return;
  if (!claimScanDir(scan)) return;
  if (!(await exists(dir))) return;
  const names = (await readdir(dir)).sort();
  for (const name of names) {
    if (scan.stopped) break;
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
        scan,
        options,
      );
      continue;
    }
    if (!/\.(md|mdc|markdown)$/i.test(name)) continue;
    if (!claimScanEntry(scan, entryStat.size)) {
      if (scan.stopped) break;
      continue;
    }
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
  // Persona / standing under product dirs (`{XRK_HOME}` and workspace `.xrk/`).
  // Host seeds home `AGENTS.md` + `SOUL.md` + `XRK.md` (fingerprint refresh).
  // User-authored persona overlays: `{workspace}/.xrk/{SOUL,IDENTITY,USER,TOOLS}.md`.
  // Industry `.agents/` is AGENTS / rules / context / skills only (no SOUL inject).
  // Standing USER.md ≠ curated `{XRK_HOME}/memories/USER.md` (exec-memory).
  "SOUL.md",
  "USER.md",
  "IDENTITY.md",
  "TOOLS.md",
  "AGENTS.md",
] as const;

/**
 * Same standing dirs / digest path as {@link PRODUCT_STANDING_FILES}, but only
 * for workspace-frequent seats (经理 · 向日葵 · coding/IM parents = audience=user).
 * Never pushed for 干员家 / delegated children (`subagent` | `minimal`).
 */
const MANAGER_STANDING_FILES = ["XRK.md"] as const;

/** Multi-vendor convention paths under one base directory. */
async function pushConventionLayer(
  sections: InstructionSection[],
  base: string,
  logicalPrefix: string,
  budget: InjectBudget,
  seen: Set<string>,
  profile: ConventionInjectProfile,
  scan: ScanBudget,
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
      scan,
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
      scan,
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
      scan,
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
      scan,
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

/** Manager / 向日葵 ledger under the same product dirs as AGENTS.md. */
async function pushManagerStanding(
  sections: InstructionSection[],
  productDir: string,
  logicalPrefix: string,
  budget: InjectBudget,
  seen: Set<string>,
): Promise<void> {
  if (!(await exists(productDir))) return;
  for (const name of MANAGER_STANDING_FILES) {
    await pushFile(
      sections,
      path.join(productDir, name),
      `${logicalPrefix}${name}`,
      budget,
      seen,
    );
  }
}

/**
 * Gather agent instruction markdown from multi-vendor convention paths.
 * Policy: {@link HOME_CONVENTION_INJECT} · {@link WORKSPACE_CONVENTION_INJECT} in `inject-sources.ts`.
 * Low → high in output order (later sections sit closer to the turn):
 *
 * 1. Home product standing `~/.xrk` AGENTS/SOUL/… (every audience)
 * 2. Home convention `~/.agents` · `~/.claude` · `~/.codex` (every audience)
 * 3. Manager ledger `XRK.md` — `audience=user` only (经理 / 向日葵 parents)
 * 4. Workspace convention (every present vendor)
 * 5. Workspace `{productDir}` AGENTS/SOUL/… (default `.xrk/`)
 * 6. Workspace root `AGENTS.md` / `CLAUDE.md` (`xrk-inject: false` opts out)
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
  const scan = createScanBudget();
  const includeUserHome = options.includeUserHome !== false;
  /** Manager ledger only — never gates standing / convention / skills. */
  const managerLedger =
    options.audience !== "subagent" && options.audience !== "minimal";
  const homeProduct = resolveUserProductHome(options.homeDir);
  const homeProductPrefix = userProductHomeLogicalPrefix(options.homeDir);

  if (includeUserHome) {
    await pushProductStanding(
      sections,
      homeProduct,
      homeProductPrefix,
      options.budget,
      seen,
    );
    const home = path.resolve(options.homeDir ?? homedir());
    await pushConventionLayer(
      sections,
      home,
      "~/",
      options.budget,
      seen,
      HOME_CONVENTION_INJECT,
      scan,
    );
    if (managerLedger) {
      await pushManagerStanding(
        sections,
        homeProduct,
        homeProductPrefix,
        options.budget,
        seen,
      );
      await pushFile(
        sections,
        path.join(home, "XRK.md"),
        "~/XRK.md",
        options.budget,
        seen,
      );
    }
  }

  if (managerLedger) {
    await pushFile(
      sections,
      path.join(root, "XRK.md"),
      "XRK.md",
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
    scan,
  );
  await pushProductStanding(sections, productDir, ".xrk/", options.budget, seen);
  if (managerLedger) {
    await pushManagerStanding(
      sections,
      productDir,
      ".xrk/",
      options.budget,
      seen,
    );
  }

  // Root AGENTS.md always attempted alongside every present vendor overlay
  // (.agents / .claude / .cursor/rules / .codex / .xrk) — multi-agent same-repo.
  // Opt out per file via `xrk-inject: false` (this monorepo's maintainer AGENTS).
  await pushFile(
    sections,
    path.join(root, "AGENTS.md"),
    "AGENTS.md",
    options.budget,
    seen,
  );

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
  // Provenance: every section names its source path so the model can tell a
  // project doc from a persona doc even after compaction drops the headers
  // (Codex `agents_md.rs` keeps the same lineage).
  return sections.map(
    (s) =>
      `## ${s.path}\n> source: ${s.path}\n${s.body}`,
  );
}

export function sectionsToInstructionChanges(
  sections: readonly InstructionSection[],
): InstructionChange[] {
  return sections.map((s) => ({
    action: "merge" as const,
    path: s.path,
  }));
}
