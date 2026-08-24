import { access, readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import type { InstructionChange, WorkspaceBudgetEvent } from "./durable-inject.js";

export interface InstructionSection {
  /** Stable path for `changes[]` and section headers (posix-style). */
  readonly path: string;
  readonly body: string;
}

export interface CollectEcosystemInstructionsOptions {
  readonly root: string;
  readonly productDir: string;
  readonly budget: {
    left: number;
    events: WorkspaceBudgetEvent[];
  };
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
  budget: CollectEcosystemInstructionsOptions["budget"],
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

function stripMdcFrontmatter(raw: string): string {
  const body = raw.replace(/^\uFEFF/, "");
  if (!body.startsWith("---")) return body;
  const end = body.indexOf("\n---", 3);
  if (end <= 0) return body;
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
  budget: CollectEcosystemInstructionsOptions["budget"],
  seen: Set<string>,
): Promise<void> {
  const raw = await readIfExists(absPath);
  if (!raw?.trim()) return;
  const digest = raw.trim();
  if (seen.has(digest)) return;
  const clipped = clip(logicalPath, raw, budget);
  if (!clipped.trim()) return;
  seen.add(digest);
  sections.push({ path: logicalPath, body: clipped });
}

async function pushMarkdownDir(
  sections: InstructionSection[],
  dir: string,
  prefix: string,
  budget: CollectEcosystemInstructionsOptions["budget"],
  seen: Set<string>,
  options?: { readonly stripMdc?: boolean },
): Promise<void> {
  if (!(await exists(dir))) return;
  const names = (await readdir(dir)).sort();
  for (const name of names) {
    const abs = path.join(dir, name);
    const entryStat = await stat(abs);
    if (entryStat.isDirectory()) {
      await pushMarkdownDir(
        sections,
        abs,
        `${prefix}${name}/`,
        budget,
        seen,
        options,
      );
      continue;
    }
    if (!/\.(md|mdc|markdown)$/i.test(name)) continue;
    const raw = await readIfExists(abs);
    if (!raw?.trim()) continue;
    let body = raw;
    if (options?.stripMdc || name.endsWith(".mdc")) {
      body = stripMdcFrontmatter(raw);
    }
    if (!body.trim()) continue;
    const logical = `${prefix}${name}`.replace(/\\/g, "/");
    const digest = body.trim();
    if (seen.has(digest)) continue;
    const clipped = clip(logical, body, budget);
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

/**
 * Gather agent instruction markdown from multi-vendor convention paths.
 * Low → high priority in output order (later sections appear closer to the turn).
 *
 * Skills trees and `.agents/skills` are handled separately (skill catalog).
 */
export async function collectEcosystemInstructions(
  options: CollectEcosystemInstructionsOptions,
): Promise<InstructionSection[]> {
  const root = path.resolve(options.root);
  const productDir = path.resolve(options.productDir);
  const sections: InstructionSection[] = [];
  const seen = new Set<string>();

  // Codex
  await pushFile(
    sections,
    path.join(root, ".codex", "AGENTS.md"),
    ".codex/AGENTS.md",
    options.budget,
    seen,
  );
  await pushFile(
    sections,
    path.join(root, "CODEX.md"),
    "CODEX.md",
    options.budget,
    seen,
  );

  // Claude Code
  await pushFile(
    sections,
    path.join(root, ".claude", "CLAUDE.md"),
    ".claude/CLAUDE.md",
    options.budget,
    seen,
  );
  await pushMarkdownDir(
    sections,
    path.join(root, ".claude", "rules"),
    ".claude/rules/",
    options.budget,
    seen,
  );

  // Vendor-neutral `.agents` (exclude skills/ and notes/ trees)
  await pushFile(
    sections,
    path.join(root, ".agents", "AGENTS.md"),
    ".agents/AGENTS.md",
    options.budget,
    seen,
  );
  await pushMarkdownDir(
    sections,
    path.join(root, ".agents", "rules"),
    ".agents/rules/",
    options.budget,
    seen,
  );

  // Cursor rules (.mdc)
  await pushMarkdownDir(
    sections,
    path.join(root, ".cursor", "rules"),
    ".cursor/rules/",
    options.budget,
    seen,
    { stripMdc: true },
  );

  // GitHub Copilot / instructions
  await pushFile(
    sections,
    path.join(root, ".github", "copilot-instructions.md"),
    ".github/copilot-instructions.md",
    options.budget,
    seen,
  );
  await pushMarkdownDir(
    sections,
    path.join(root, ".github", "instructions"),
    ".github/instructions/",
    options.budget,
    seen,
  );

  // XRK product dir standing files + context
  for (const name of PRODUCT_STANDING_FILES) {
    await pushFile(
      sections,
      path.join(productDir, name),
      `.xrk/${name}`,
      options.budget,
      seen,
    );
  }

  const assistant =
    (await readIfExists(path.join(productDir, "assistant.md"))) ??
    (await readIfExists(path.join(productDir, "ASSISTANT.md")));
  if (assistant?.trim()) {
    const assistantPath = (await exists(path.join(productDir, "assistant.md")))
      ? ".xrk/assistant.md"
      : ".xrk/ASSISTANT.md";
    const clipped = clip(assistantPath, assistant, options.budget);
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
        `.xrk/context/${f}`,
        options.budget,
        seen,
      );
    }
  }

  const rules =
    (await readIfExists(path.join(productDir, "rules.md"))) ??
    (await readIfExists(path.join(productDir, "RULES.md")));
  if (rules?.trim()) {
    const rulesPath = (await exists(path.join(productDir, "rules.md")))
      ? ".xrk/rules.md"
      : ".xrk/RULES.md";
    const clipped = clip(rulesPath, rules, options.budget);
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
    const clipped = clip(".xrk/subagents.md", subagents, options.budget);
    if (clipped.trim()) {
      const digest = clipped.trim();
      if (!seen.has(digest)) {
        seen.add(digest);
        sections.push({ path: ".xrk/subagents.md", body: clipped });
      }
    }
  }

  // Workspace root standing files (open standard + Claude bridge)
  await pushFile(
    sections,
    path.join(root, "AGENTS.md"),
    "AGENTS.md",
    options.budget,
    seen,
  );

  const claudeRoot = await readIfExists(path.join(root, "CLAUDE.md"));
  if (claudeRoot?.trim() && !isAgentsImportOnly(claudeRoot)) {
    const clipped = clip("CLAUDE.md", claudeRoot, options.budget);
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
