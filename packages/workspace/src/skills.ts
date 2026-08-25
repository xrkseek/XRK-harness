import { access, open, readdir, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { skillDirsFingerprint } from "./inject-fingerprint.js";
import { shouldSkipScanDir } from "./scan-guards.js";

export interface SkillSummary {
  readonly name: string;
  readonly description: string;
  readonly whenToUse?: string;
  /** False → omit from catalog / `skill` tool (DSH `disable-model-invocation`). */
  readonly modelInvocable: boolean;
  /** False → omit from `/skill-name` slash expand (DSH `user-invocable: false`). */
  readonly userInvocable: boolean;
  /** Directory name that contains `SKILL.md`. */
  readonly dirName: string;
  readonly directory: string;
}

export interface SkillDefinition extends SkillSummary {
  /** Markdown body with YAML frontmatter stripped. */
  readonly content: string;
}

/** Options shared by list / load / tools / slash. */
export interface SkillSourceOptions {
  /**
   * Project root: auto-import existing skill dirs under
   * `.codex` / `.claude` / `.agents` / `.cursor` / `.xrk` (never mkdir).
   */
  readonly workspaceRoot?: string;
  /**
   * Legacy single product root → `{productDir}/skills` only.
   * Prefer `workspaceRoot` for multi-vendor import.
   */
  readonly productDir?: string;
  /** Explicit skill roots (each is a skills directory). */
  readonly skillDirs?: readonly string[];
  /**
   * Also scan `~/.codex|claude|agents|cursor|xrk/skills` when using workspaceRoot.
   * Default true. Tests that assert exact lists should pass false.
   */
  readonly includeUserHome?: boolean;
}

const MAX_NAME = 128;
/** Frontmatter + description fit in the first slice; avoids reading huge SKILL.md bodies for catalog scans. */
const SKILL_HEAD_BYTES = 16_384;

const skillListCache = new Map<
  string,
  { readonly skills: readonly SkillSummary[] }
>();

/** Test / hot-reload hook. */
export function clearSkillListCache(): void {
  skillListCache.clear();
}

async function readSkillHead(skillFile: string): Promise<string> {
  const handle = await open(skillFile, "r");
  try {
    const buf = Buffer.alloc(SKILL_HEAD_BYTES);
    const { bytesRead } = await handle.read(buf, 0, SKILL_HEAD_BYTES, 0);
    return buf.toString("utf8", 0, bytesRead);
  } finally {
    await handle.close();
  }
}

/**
 * Relative project skill roots, low → high priority (later wins on name clash).
 * Matches Cursor/Claude/Codex layouts; `.xrk/skills` is the XRK-native overlay.
 */
export const PROJECT_SKILL_REL_DIRS = [
  ".codex/skills",
  ".claude/skills",
  ".agents/skills",
  ".cursor/skills",
  ".xrk/skills",
] as const;

/** User-home skill roots (same order; lower than any project root). */
export const USER_SKILL_REL_DIRS = [
  ".codex/skills",
  ".claude/skills",
  ".agents/skills",
  ".cursor/skills",
  ".xrk/skills",
] as const;

export function isSkillName(name: string): boolean {
  const trimmed = name.trim();
  if (!trimmed || trimmed.length > MAX_NAME) return false;
  if (trimmed === "." || trimmed === "..") return false;
  if (trimmed.includes("/") || trimmed.includes("\\") || trimmed.includes("\0")) {
    return false;
  }
  return true;
}

export type ParsedSkillFrontmatter = {
  readonly name: string;
  readonly description: string;
  readonly whenToUse?: string;
  readonly content: string;
  readonly modelInvocable: boolean;
  readonly userInvocable: boolean;
  /**
   * True when disable-model-invocation / user-invocable frontmatter is present
   * but not a boolean — skill is dropped (fail-closed, DSH).
   */
  readonly invalid: boolean;
};

function parseFrontmatterBool(
  raw: string,
): boolean | "invalid" {
  const v = raw.trim().toLowerCase();
  if (v === "true" || v === "yes" || v === "1") return true;
  if (v === "false" || v === "no" || v === "0") return false;
  return "invalid";
}

export function parseSkillMarkdown(
  raw: string,
  fallbackName: string,
): ParsedSkillFrontmatter {
  let body = raw.replace(/^\uFEFF/, "");
  let name = fallbackName;
  let description = "";
  let whenToUse: string | undefined;
  let modelInvocable = true;
  let userInvocable = true;
  let invalid = false;

  if (body.startsWith("---")) {
    const end = body.indexOf("\n---", 3);
    if (end > 0) {
      const fm = body.slice(3, end).trim();
      body = body.slice(end + 4).replace(/^\r?\n/, "");
      for (const line of fm.split(/\r?\n/)) {
        const m = /^([\w-]+)\s*:\s*(.*)$/.exec(line.trim());
        if (!m) continue;
        const key = m[1]!;
        const val = m[2]!.replace(/^["']|["']$/g, "").trim();
        if (key === "name" && val) name = val;
        if (key === "description" && val) description = val;
        if ((key === "whenToUse" || key === "when_to_use") && val) {
          whenToUse = val;
        }
        if (
          key === "disable-model-invocation" ||
          key === "disable_model_invocation"
        ) {
          const b = parseFrontmatterBool(val);
          if (b === "invalid") invalid = true;
          else modelInvocable = !b;
        }
        if (key === "user-invocable" || key === "user_invocable") {
          const b = parseFrontmatterBool(val);
          if (b === "invalid") invalid = true;
          else userInvocable = b;
        }
      }
    }
  }

  const content = body.trim();
  if (!description) {
    const first = content
      .split(/\r?\n/)
      .map((l) => l.replace(/^#+\s*/, "").trim())
      .find((l) => l.length > 0);
    description = first ?? name;
  }

  return {
    name,
    description,
    ...(whenToUse ? { whenToUse } : {}),
    content,
    modelInvocable,
    userInvocable,
    invalid,
  };
}

async function dirExists(p: string): Promise<boolean> {
  try {
    await access(p);
    const st = await stat(p);
    return st.isDirectory();
  } catch {
    return false;
  }
}

/**
 * Existing skill directories only — never creates paths.
 * Order: user homes (if enabled) → project vendors → optional productDir/skills.
 */
export async function resolveSkillDirs(
  options: SkillSourceOptions,
): Promise<readonly string[]> {
  if (options.skillDirs && options.skillDirs.length > 0) {
    const out: string[] = [];
    for (const dir of options.skillDirs) {
      const abs = path.resolve(dir);
      if (await dirExists(abs)) out.push(abs);
    }
    return out;
  }

  const out: string[] = [];
  const seen = new Set<string>();
  const push = async (abs: string) => {
    const key = path.resolve(abs);
    if (seen.has(key)) return;
    if (!(await dirExists(key))) return;
    seen.add(key);
    out.push(key);
  };

  if (options.workspaceRoot) {
    const root = path.resolve(options.workspaceRoot);
    const includeUser = options.includeUserHome !== false;
    if (includeUser) {
      const home = homedir();
      for (const rel of USER_SKILL_REL_DIRS) {
        await push(path.join(home, rel));
      }
    }
    for (const rel of PROJECT_SKILL_REL_DIRS) {
      await push(path.join(root, rel));
    }
  }

  if (options.productDir) {
    await push(path.join(path.resolve(options.productDir), "skills"));
  }

  return out;
}

/** Scan one skills directory for child SKILL.md folders (missing root → []). */
export async function listSkillsInDir(
  skillsRoot: string,
): Promise<readonly SkillSummary[]> {
  const root = path.resolve(skillsRoot);
  let names: string[];
  try {
    names = await readdir(root);
  } catch {
    return [];
  }

  const out: SkillSummary[] = [];
  for (const dirName of names) {
    if (shouldSkipScanDir(dirName)) continue;
    if (!isSkillName(dirName)) continue;
    const directory = path.join(root, dirName);
    try {
      const st = await stat(directory);
      if (!st.isDirectory()) continue;
    } catch {
      continue;
    }
    const skillFile = path.join(directory, "SKILL.md");
    let parsed: ParsedSkillFrontmatter;
    try {
      const raw = await readSkillHead(skillFile);
      parsed = parseSkillMarkdown(raw, dirName);
    } catch {
      parsed = {
        name: dirName,
        description: dirName,
        content: "",
        modelInvocable: true,
        userInvocable: true,
        invalid: false,
      };
    }
    if (parsed.invalid) continue;
    if (!isSkillName(parsed.name)) continue;
    out.push({
      name: parsed.name,
      description: parsed.description,
      ...(parsed.whenToUse ? { whenToUse: parsed.whenToUse } : {}),
      modelInvocable: parsed.modelInvocable,
      userInvocable: parsed.userInvocable,
      dirName,
      directory,
    });
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

/**
 * Merge skill roots; later roots win on name / dirName clash.
 * Missing dirs are skipped (no mkdir).
 */
export async function listSkills(
  options: SkillSourceOptions & { readonly productDir?: string },
): Promise<readonly SkillSummary[]> {
  const dirs = await resolveSkillDirs(options);
  if (dirs.length === 0) return [];

  const fingerprint = await skillDirsFingerprint(dirs);
  const hit = skillListCache.get(fingerprint);
  if (hit !== undefined) return hit.skills;

  const byName = new Map<string, SkillSummary>();
  for (const dir of dirs) {
    for (const skill of await listSkillsInDir(dir)) {
      byName.set(skill.name, skill);
    }
  }
  const skills = [...byName.values()].sort((a, b) =>
    a.name.localeCompare(b.name),
  );
  skillListCache.clear();
  skillListCache.set(fingerprint, { skills });
  return skills;
}

export async function listSkillsFromWorkspace(
  workspaceRoot: string,
  options?: { readonly includeUserHome?: boolean },
): Promise<readonly SkillSummary[]> {
  return listSkills({
    workspaceRoot,
    ...(options?.includeUserHome !== undefined
      ? { includeUserHome: options.includeUserHome }
      : {}),
  });
}

export async function loadSkill(
  options: SkillSourceOptions & { readonly name: string },
): Promise<SkillDefinition | undefined> {
  const wanted = options.name.trim();
  if (!isSkillName(wanted)) return undefined;
  const listed = await listSkills(options);
  const summary = listed.find(
    (s) => s.name === wanted || s.dirName === wanted,
  );
  if (!summary) return undefined;
  const skillFile = path.join(summary.directory, "SKILL.md");
  let parsed: ReturnType<typeof parseSkillMarkdown>;
  try {
    const raw = await readFile(skillFile, "utf8");
    parsed = parseSkillMarkdown(raw, summary.dirName);
  } catch {
    return {
      ...summary,
      content: "",
    };
  }
  return {
    ...summary,
    name: parsed.name,
    description: parsed.description,
    ...(parsed.whenToUse ? { whenToUse: parsed.whenToUse } : {}),
    modelInvocable: summary.modelInvocable,
    userInvocable: summary.userInvocable,
    content: parsed.content,
  };
}

export function formatSkillCatalog(
  skills: readonly SkillSummary[],
): string | undefined {
  const listed = skills.filter((s) => s.modelInvocable);
  if (listed.length === 0) return undefined;
  const lines = listed.map((s) => {
    const extra = s.whenToUse ? ` When to use: ${s.whenToUse}` : "";
    return `- **${s.name}**: ${s.description}.${extra}`;
  });
  return [
    "## Skills",
    ...lines,
    "Use the skill tool with the exact skill name to load full instructions before acting on a matching task.",
  ].join("\n");
}

function escapeAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;");
}

/** Model-facing load payload. Directory skills resolve relative paths from `directory`. */
export function renderSkillContent(skill: SkillDefinition): string {
  return [
    `<skill_content name="${escapeAttr(skill.name)}">`,
    "<skill_resources>",
    `Base directory for this skill: ${skill.directory}`,
    "Resolve relative paths mentioned by this skill against the base directory before using them. Load referenced resources only as needed.",
    "</skill_resources>",
    "",
    "<skill_instructions>",
    skill.content,
    "</skill_instructions>",
    "</skill_content>",
  ].join("\n");
}

export const SKILL_TOOL_GUIDANCE =
  "Use the skill tool to load the full instructions for an available skill listed in the Skills catalog. Call it with the exact skill name before acting on a task that names or clearly matches that skill.";
